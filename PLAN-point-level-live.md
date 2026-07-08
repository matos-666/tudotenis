# PLAN: Estado ponto-a-ponto no live (ptA/ptB deixarem de ser 0-0)

## Objectivo

O modelo Markov live IGNORA o score de pontos dentro do game. Em
`src/lib/live-poll.ts`, função `buildState` (grep `ptA: 0`):

```ts
  // Sportradar não publica point-level na season fixtures; vamos
  // inferir do timeline-delta separately. Por agora point=0-0 a
  // cada snapshot (refinado em iteração seguinte com timeline).
  return {
    ptA: 0,
    ptB: 0,
```

Consequências reais:
- `matchWinProb`/`pointImportance` (em `src/lib/live-markov.ts`, que JÁ
  aceitam `ptA/ptB`) calculam sempre como se o game estivesse 0-0. Num
  40-0 vs 0-40 a prob real difere vários pontos percentuais.
- `point_importance` subestimada em break points → o guard
  `importance > 0.18` do `maybeEmitPick` deixa passar emissões em momentos
  quentes que devia bloquear.
- O tracker do site mostra sempre pontos 0-0 (o `MatchTracker` lê
  `point_a/point_b` da snapshot).
- O `server` também está hardcoded `'A'` no `buildState` (grep
  `server: 'A', // refined later`) — o Markov alterna o serviço a partir
  de um ponto de partida errado em ~50% dos games.

## Ficheiros a tocar

1. `src/lib/live-poll.ts` (fetch da fonte de pontos + `buildState` +
   `processMatch`)

## Passo 0 — INVESTIGAÇÃO OBRIGATÓRIA (fazer antes de escrever código)

A SR gismo tem vários endpoints candidatos para score de pontos. Correr
com um matchId LIVE real (ir buscar um a
`select sr_match_id from live_state where running=true order by captured_at desc limit 1`):

```bash
UA="Mozilla/5.0"; REF="https://widgets.sir.sportradar.com/betradar/en/live-match-tracker"; ORI="https://widgets.sir.sportradar.com"
for EP in match_get match_timeline match_detailsextended stats_match_situation match_info; do
  echo "=== $EP ==="
  /usr/bin/curl -s -H "User-Agent: $UA" -H "Referer: $REF" -H "Origin: $ORI" \
    "https://lmt.fn.sportradar.com/betradar/en/Etc:UTC/gismo/${EP}/<MATCH_ID>" \
    | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const s=JSON.stringify(d);["gamescore","points","score","P15","P30","P40","serve","server"].forEach(k=>{const i=s.indexOf(k);if(i>=0)console.log(`  "${k}" @${i}: …${s.slice(Math.max(0,i-60),i+120)}…`)})' 2>/dev/null | /usr/bin/head -12
done
```

Procurar no output:
- Campo tipo `gamescore: {home: "40", away: "15"}` ou `points: "40:15"` no
  `match_get` (ideal — zero requests extra).
- No `match_timeline`: eventos com `type: point` e último game derivável.
- `server`/`servingteam`/`serve` para saber quem serve.

**Se `match_get` tiver os pontos** → implementar via Passo 1-A (grátis).
**Se só o `match_timeline` tiver** → Passo 1-B (1 request extra por match
por ciclo — aceitável, corre no runner, não no Vercel).
**Se NENHUM endpoint der pontos** → implementar apenas o `server` correcto
(que o timeline dá de certeza via ordem dos games) e PARAR — documentar no
código o que foi tentado, com exemplos de payload.

## Passos, por ordem (assumindo 1-A ou 1-B viável)

### Passo 1-A — Pontos do `match_get`

Em `buildState` (que já recebe o `SrMatchGet` completo): adicionar ao
interface `SrMatchGet` o campo descoberto (ex.: `gamescore?: { home: string
| number; away: string | number }`), e mapear para ptA/ptB (ver tabela de
conversão no Passo 2).

### Passo 1-B — Pontos do `match_timeline`

Em `processMatch`, junto ao fetch de stats (grep `needsStats`): fazer
`sr<...>(\`match_timeline/${m._id}\`)` no MESMO bucket de 30s (não a cada
ciclo). Derivar do último evento o score de pontos do game corrente e quem
serve. Carry-forward do `lastSnap` quando não re-fetcha (tal como as stats
já fazem).

### Passo 2 — Conversão de representação

O Markov (`live-markov.ts`) usa pontos como INTEIROS 0..4 (0,1,2,3=40,
4=advantage — CONFIRMAR lendo `matchWinProb`/`gameWinProb` no ficheiro
antes de mapear). A SR dá "0"/"15"/"30"/"40"/"A"|"AD"|"50". Tabela:

```ts
const PT_MAP: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4, 'AD': 4, '50': 4 };
```

Em tiebreak os pontos são contagem directa (0,1,2,...) — passar tal e qual,
MAS verificar o que o Markov espera em TB (ler `tiebreakWinProb` no
`live-markov.ts`; se espera contagem directa está alinhado).

### Passo 3 — `server` real

Do timeline (ou campo do match_get se existir): quem serve o game corrente.
Substituir o `server: 'A'` hardcoded do `buildState`. Se indisponível num
ciclo, carry-forward do `lastSnap.server` (coluna já existe na
`live_state`).

### Passo 4 — Rebaixar nada, validar tudo

NÃO mudar thresholds (`importance > 0.18` etc.) neste plano — primeiro
deixar o novo input correr 1-2 dias e comparar a distribuição de
`point_importance` antes/depois. Mudanças de threshold são plano separado.

### Passo 5 — Typecheck + teste local + commit

```bash
npx tsc --noEmit -p .
# com um match live a decorrer:
POLL_RUNTIME_MS=35000 npx tsx scripts/poll-live.ts
# verificar na DB que a snapshot nova tem point_a/point_b ≠ 0-0 (se o game
# corrente não estiver mesmo 0-0) e server correcto vs o widget da SR.
```

## Edge cases (não saltar)

1. **A lógica corre no runner** (`scripts/poll-live.ts` → `lib/live-poll.ts`)
   — o wrapper Vercel não importa para o polling. Não "testar no site" sem
   antes confirmar snapshots na DB.
2. **Rate/custo SR**: o timeline por match por ciclo de 30s para ~10
   matches = ~20 req/min extra à SR. Usar o MESMO bucket de 30s das stats
   (`needsStats`) para não duplicar chamadas; se a SR começar a dar 403,
   subir o bucket para 60s só para o timeline.
3. **Advantage e deuce**: "40:40" → (3,3); "A:40" → (4,3). Se o Markov não
   suportar 4 (advantage), mapear AD para 3 e deixar comentário — errado
   por meio ponto é melhor que rebentar o cálculo.
4. **Tiebreak**: `buildState` marca `tiebreak` quando 6-6; os pontos do TB
   NÃO passam pelo PT_MAP (são inteiros directos). Dois caminhos de parsing.
5. **`point_importance` vai subir** em média (agora vê break points reais).
   O guard `importance > 0.18` vai bloquear MAIS emissões — é o
   comportamento desejado (era esse o propósito do guard), mas esperar
   menos picks/dia e não "corrigir" isso em pânico.
6. **isBreakMoment usa games, não pontos** — não é afectado. Confirmar que
   nada mais em `live-poll.ts` assume `ptA===0`.
7. **UI**: o `MatchTracker` e o tooltip do chart já leem `point_a/point_b`
   — passam a mostrar valores reais sem alteração. O formato deles espera
   inteiros (0-4)? LER `MatchTracker.tsx` (grep `point_a`) e confirmar a
   renderização (se mostra "40" convertendo, ou o raw) antes de dar por
   terminado.

## Critérios de aceitação

1. `npx tsc --noEmit` limpo.
2. Durante um match live: ≥50% das snapshots num período de 10 min têm
   `point_a + point_b > 0` (games raramente estão todos a 0-0).
3. `server` na snapshot alterna entre games consecutivos (verificável com
   SQL: server do game N ≠ server do game N+1 na esmagadora maioria).
4. Comparação manual com o widget SR do mesmo match: pontos e servidor
   coincidem em 3 verificações espaçadas.
5. `match_win_prob_a` reage dentro do game (ex.: cai visivelmente quando o
   jogador A está 0-40 ao serviço) — visível no chart da página do jogo.
