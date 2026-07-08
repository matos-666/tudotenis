# PLAN: Sanity-gate modelo-vs-mercado + shrinkage do surface-ELO

## Objectivo

Impedir que o modelo emita picks quando diverge absurdamente do mercado, e
corrigir a raiz dessa divergência (surface-ELO com amostra pequena).

**Evidência real (2026-07-06, match 72320482 Keys vs Noskova):**
- Mercado Twin: Keys @1.50 (62.5% implícita) favorita.
- Nosso modelo: Noskova 87% — porque `elo_set_grass` da Keys era 1540
  (absurdamente baixo para uma #12; a época de relva tem amostra minúscula).
- Resultado: emitimos pick grade A na Noskova @1.95 com "edge" +72% — edge
  fantasma nascido de erro de calibração, não de valor.
- O pipeline pré-live tinha bloqueado o mesmo match (cap de EV 30%), mas o
  live tem cap 100% → inconsistência.

## Ficheiros a tocar

1. `src/lib/live-poll.ts` (emissão live — a lógica vive AQUI desde o
   refactor para o runner; NÃO editar o wrapper
   `src/app/api/cron/live-state/route.ts`)
2. `src/app/api/cron/picks-twin-ingest/route.ts` (emissão pré-live singles
   e duplas)
3. `src/app/ao-vivo/page.tsx` (badge "VALOR" — manter coerente com a
   emissão)

## Passos, por ordem

### Passo 1 — Baixar o cap de edge do live de 100% para 30%

Em `src/lib/live-poll.ts`, localizar (grep `edgePct > 100`):

```ts
  if (liveOdd < 1.25 || liveOdd > 4.0) return false;
  const edgePct = +((conviction * liveOdd - 1) * 100).toFixed(2);
  if (edgePct > 100) return false;
```

Trocar `100` por `30` e actualizar o comentário: alinha com o `MAX_EV = 0.30`
do pré-live (`picks-twin-ingest`). Edge acima de 30% em ténis é quase sempre
erro do modelo — a Twin é eficiente.

### Passo 2 — Sanity-gate de divergência no live

No mesmo bloco de `maybeEmitPick` (em `src/lib/live-poll.ts`), o código já
faz fetch da última odd (grep `FRESH_ODD_MS`). O `select` actual pede
`odd_a, odd_b, source, captured_at` — ambas as odds JÁ estão disponíveis.
Depois do cap do Passo 1, adicionar:

```ts
  // Sanity-gate modelo-vs-mercado: prob implícita de-vigada do mercado.
  // Se divergimos mais de 20pp do mercado, o erro é quase sempre NOSSO
  // (surface-ELO mal calibrado, amostra pequena) — caso real: Keys 1540
  // de grass ELO deu Noskova 87% quando o mercado dava 37.5%.
  const MAX_MODEL_MARKET_DIVERGENCE = 0.20;
  const otherOddRaw = selection === 'A' ? latestOdd?.odd_b : latestOdd?.odd_a;
  const otherOdd = otherOddRaw != null ? Number(otherOddRaw) : null;
  if (otherOdd != null && otherOdd > 1) {
    const inv = 1 / liveOdd + 1 / otherOdd;
    const marketProb = (1 / liveOdd) / inv; // prob de-vigada da NOSSA selecção
    if (Math.abs(conviction - marketProb) > MAX_MODEL_MARKET_DIVERGENCE) {
      return false;
    }
  }
```

**Atenção**: `conviction` é a prob da selecção escolhida (não `matchProb`,
que é sempre do lado A). O `liveOdd` também já é o da selecção. Comparar
sempre selecção-com-selecção.

### Passo 3 — Sanity-gate no pré-live singles

Em `src/app/api/cron/picks-twin-ingest/route.ts`, localizar o bloco singles
(grep `const MAX_EV = 0.30`). Após a escolha de `pickPlayer/pickOdd/pickEv`
e ANTES do dedup, adicionar o mesmo gate:

```ts
    // Sanity-gate modelo-vs-mercado (ver PLAN-model-market-gate.md)
    const pickProb = pickPlayer === pA ? matchProbA : matchProbB;
    const otherOdd = pickPlayer === pA ? m.odd_b : m.odd_a;
    if (otherOdd > 1) {
      const inv = 1 / pickOdd + 1 / otherOdd;
      const marketProb = (1 / pickOdd) / inv;
      if (Math.abs(pickProb - marketProb) > 0.20) { skipped++; continue; }
    }
```

Fazer o equivalente em `processDoubles` (grep `teamSel = 1`): a prob da
selecção é `teamSel === 1 ? matchProbA : matchProbB`, odds idem.

### Passo 4 — Shrinkage do surface-ELO

**Contexto**: `players` NÃO tem contagem de sets POR SUPERFÍCIE (verificado)
— só `set_count` total. Logo, shrinkage por amostra exacta não é possível
sem migração. Usar blend fixo, que já mata a maior parte do erro:

`elo_efectivo = 0.65 × elo_set_{surface} + 0.35 × (elo_set_overall ?? elo_overall)`

4a. Em `src/lib/live-poll.ts`, função `fetchPlayerEloTour` (grep
`async function fetchPlayerEloTour`). O select actual é
`'elo_set_grass, elo_overall, tour'`. Alterar para
`'elo_set_grass, elo_set_overall, elo_overall, tour'` e substituir o cálculo:

```ts
  const grass = data.elo_set_grass as number | null;
  const base = (data.elo_set_overall as number | null) ?? (data.elo_overall as number | null);
  let elo: number | null = null;
  if (grass != null && base != null) elo = 0.65 * grass + 0.35 * base;
  else elo = grass ?? base;
```

4b. Em `picks-twin-ingest/route.ts`, função `eloFor` (grep `function eloFor`):
aplicar o mesmo blend entre `p[key]` (surface) e
`p.elo_set_overall ?? p.elo_overall`.

4c. (Opcional, mesma sessão) `resolveDoublesTeamElo` em `live-poll.ts`:
blend entre `elo_doubles_grass` e `elo_doubles_overall`.

### Passo 5 — Coerência do badge "VALOR" no /ao-vivo

Em `src/app/ao-vivo/page.tsx`, função `isOurBet` (grep `function isOurBet`):
adicionar o mesmo gate de divergência (a página já tem `prob` e as duas
odds nos SidePanels — passar a odd do lado oposto à função ou calcular no
caller). Se ficar complexo, alternativa aceitável: baixar o threshold de
edge implícito do badge para ≤30% via novo parâmetro. O objectivo é o site
nunca gritar "VALOR +72%" numa situação que a emissão bloquearia.

### Passo 6 — Typecheck + commit

```bash
npx tsc --noEmit -p .
git add -A && git commit -m "feat(model): sanity-gate modelo-vs-mercado + shrinkage surface-ELO" && git push
```

## Edge cases (descobertos na exploração — não saltar)

1. **Odd do lado oposto em falta** (`odd_b` null na `live_odds_history`):
   sem as duas odds não há de-vig. NÃO bloquear nesse caso — aplicar só os
   caps existentes. O gate é *adicional*, não substitui.
2. **`conviction` vs `matchProb`**: em `maybeEmitPick`, `matchProb` é
   sempre do lado A; `conviction` já é da selecção (`1 - matchProb` quando
   selection === 'B'). Usar `conviction`. Comparar com a prob de mercado DA
   MESMA selecção (`1/liveOdd` de-vigada) — trocar lados é bug silencioso
   que inverte o gate.
3. **Duplas**: `processDoubles` usa team ELO médio; o gate aplica-se igual,
   mas os nomes das variáveis são `evA/evB/teamSel` — não copiar/colar o
   bloco singles sem adaptar.
4. **Pick aberta da Noskova**: pode ainda estar aberta quando isto for
   implementado. NÃO apagar retroactivamente — deixa liquidar (o histórico
   deve reflectir o que o modelo fez). O gate é só para o futuro.
5. **A lógica live NÃO está no route**: desde o commit `a51795b` vive em
   `src/lib/live-poll.ts` e corre no runner GitHub Actions. Editar o route
   não tem efeito no polling contínuo.
6. **`elo_set_overall` pode ser null** para jogadores raros — o fallback em
   cadeia (`?? elo_overall ?? só-surface`) tem de existir, senão jogadores
   sem overall perdem prior e o match fica sem modelo.

## Critérios de aceitação

1. `npx tsc --noEmit` limpo.
2. Grep confirma: `edgePct > 30` (não 100) em `src/lib/live-poll.ts`;
   `MAX_MODEL_MARKET_DIVERGENCE` presente em `live-poll.ts` E
   `picks-twin-ingest/route.ts`.
3. Replay do caso Keys/Noskova à mão: com `conviction=0.88`, `liveOdd=1.95`,
   `otherOdd=1.50` → marketProb = (1/1.95)/(1/1.95+1/1.50) ≈ 0.435;
   |0.88−0.435| = 0.445 > 0.20 → **bloqueada**. Confirmar com um
   `npx tsx -e` de 5 linhas que reproduz a aritmética.
4. Após 24-48h de picks novas, correr SQL: para cada live_pick emitida,
   `|model_prob − prob_mercado_devigada_da_odd_gravada|` ≤ 0.20 + tolerância
   de arredondamento. Zero violações.
5. ELO efectivo: para a Keys (grass 1540, set_overall 1650.5) o blend dá
   ≈ 1578.7 — verificável com uma chamada de teste à função.
