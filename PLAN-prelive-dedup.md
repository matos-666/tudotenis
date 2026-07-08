# PLAN: Dedup real das picks pré-live (fim dos duplicados entre dias)

## Objectivo

O `/picks` mostra picks duplicadas do MESMO jogo. Evidência real (dados de
produção, 2026-07-06):

```
posted=07-03T04:28  sched=07-04T09:00  [A] Iga Swiatek vs Alexandra Eala
posted=07-04T04:22  sched=07-04T11:30  [A] Iga Swiatek vs Alexandra Eala   ← duplicada
posted=07-04T04:22  sched=07-05T09:00  [A] Aryna Sabalenka vs Naomi Osaka
posted=07-05T04:43  sched=07-05T13:10  [A] Aryna Sabalenka vs Naomi Osaka  ← duplicada
```

**Causa**: o dedup em `src/app/api/cron/picks-twin-ingest/route.ts` (bloco
nas linhas ~449-458, grep `Dedup: já temos pick para este match`) só
verifica picks com `posted_at >= hoje`:

```ts
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await supabase
      .from('picks')
      .select('id')
      .eq('p1_name', pickPlayer.name)
      .eq('p2_name', pickOpp.name)
      .gte('posted_at', `${today}T00:00:00Z`)
```

O cron Twin emite às ~04:30 para jogos do dia SEGUINTE. No dia do jogo, o
cron corre outra vez, o dedup só olha para `posted_at` de hoje, não vê a
pick de ontem → segunda pick para o mesmo jogo. Isto duplica stake no
accounting de yield e parece amador no site.

Problema secundário (mesmo bloco): o dedup compara `(p1_name, p2_name)`
**ordenados pela selecção** — se o lado com EV muda entre runs (odds
mexeram), `pickPlayer`/`pickOpp` trocam e o dedup falha mesmo dentro do
mesmo dia.

O mesmo padrão existe nas duplas (grep `Dedup: já emitimos hoje esta
pick?`): filtra `posted_at >= hoje` embora o `doubles_match_id` seja
estável — mesma falha entre dias.

## Ficheiros a tocar

1. `src/app/api/cron/picks-twin-ingest/route.ts` (dedup singles + duplas)
2. Limpeza one-off dos duplicados existentes na DB (via REST, sem migração)

## Passos, por ordem

### Passo 1 — Dedup singles por (jogo, dia do jogo), qualquer ordem

Substituir o bloco de dedup singles por:

```ts
    // Dedup: 1 pick por JOGO (par de jogadores + dia do scheduled_at),
    // independente de quando foi emitida e de qual lado foi escolhido.
    // O cron emite às ~04:30 para jogos do dia seguinte; no dia do jogo
    // corre de novo — sem isto, o mesmo jogo ganhava 2ª pick (visto em
    // produção: Swiatek/Eala e Sabalenka/Osaka duplicadas).
    const schedDay = (row.scheduled_at ?? new Date().toISOString()).slice(0, 10);
    const { data: existing } = await supabase
      .from('picks')
      .select('id')
      .or(`and(p1_name.eq.${JSON.stringify(pickPlayer.name)},p2_name.eq.${JSON.stringify(pickOpp.name)}),and(p1_name.eq.${JSON.stringify(pickOpp.name)},p2_name.eq.${JSON.stringify(pickPlayer.name)})`)
      .gte('scheduled_at', `${schedDay}T00:00:00Z`)
      .lt('scheduled_at', `${schedDay}T23:59:59Z`)
      .limit(1);
    if (existing && existing.length > 0) { skipped++; continue; }
```

**ATENÇÃO à ordem no código**: o objecto `row` (que tem `scheduled_at`) é
construído DEPOIS do dedup actual. Reordenar: calcular
`const scheduled = parseKickoff(m.kickoff_date_text, m.kickoff_time_text);`
ANTES do dedup e usar essa variável tanto no dedup como no `row`.

**ATENÇÃO ao `.or()` do PostgREST**: nomes com vírgulas/parêntesis (ex.:
não existem em nomes de jogadores, mas apóstrofes existem — "O'Connell")
podem partir a sintaxe `.or()`. Alternativa mais segura e igualmente
correcta: fazer DUAS queries `.eq/.eq` (uma por ordem) ou uma query só por
`scheduled_at` do dia + filtrar os nomes em JS. Preferir a versão em JS:

```ts
    const { data: dayPicks } = await supabase
      .from('picks')
      .select('id, p1_name, p2_name')
      .gte('scheduled_at', `${schedDay}T00:00:00Z`)
      .lt('scheduled_at', `${schedDay}T23:59:59Z`)
      .limit(200);
    const pairExists = (dayPicks ?? []).some(x =>
      (x.p1_name === pickPlayer.name && x.p2_name === pickOpp.name) ||
      (x.p1_name === pickOpp.name && x.p2_name === pickPlayer.name));
    if (pairExists) { skipped++; continue; }
```

(200 picks/dia é folga enorme; 1 query extra por candidato é aceitável ao
volume actual de ~10-20 matches/run.)

### Passo 2 — Dedup duplas por match, sem janela de dia

No `processDoubles` (grep `Dedup: já emitimos hoje esta pick?`): remover o
filtro `gte('posted_at', ...)` — o `doubles_match_id` já identifica o jogo
de forma estável (o `external_key` inclui a data do jogo). Fica:

```ts
    const { data: existingPick } = await supabase
      .from('doubles_picks')
      .select('id')
      .eq('doubles_match_id', doublesMatchId)
      .limit(1);
    if (existingPick && existingPick.length > 0) return 'skipped';
```

(Nota: também remove o `.eq('team_selected', teamSel)` — 1 pick por jogo,
não 1 por lado. Se o EV trocar de lado entre runs não queremos a segunda.)

### Passo 3 — Limpeza one-off dos duplicados existentes

Script único via REST (usar o `SUPABASE_SERVICE_ROLE_KEY` do `.env.local`).
Para cada grupo `(par-de-nomes-normalizado, dia do scheduled_at)` com >1
pick e `result IS NULL`, manter a MAIS ANTIGA (primeira emissão = a odd de
referência honesta) e apagar as restantes. NÃO tocar em picks com `result`
preenchido (histórico liquidado é imutável).

Implementar como `npx tsx -e` inline ou script descartável; imprimir antes
de apagar (dry-run primeiro com `console.log`, depois repetir com delete).

### Passo 4 — Typecheck + commit

```bash
npx tsc --noEmit -p .
git add -A && git commit -m "fix(picks): dedup por jogo+dia (não por posted_at) singles e duplas" && git push
```

## Edge cases (não saltar)

1. **`scheduled_at` null** (parseKickoff falha quando a Twin não dá hora):
   usar fallback `?? new Date().toISOString()` para o dia — degrada para o
   comportamento antigo (dedup por hoje) em vez de rebentar.
2. **Lado da pick pode trocar entre runs** (odds mexem, EV muda de lado) —
   é por isso que o dedup TEM de comparar o par nas duas ordens. Se só
   comparar `(p1,p2)` como está, o bug persiste parcialmente.
3. **Retirar dia da janela nas duplas mas NÃO nos singles**: nos singles o
   par de nomes pode repetir-se legitimamente noutro torneio semanas depois
   — por isso singles dedup é (par + dia do jogo), não (par ever).
4. **Índice único `doubles_picks_dedup_idx`** (na DB, criado pelo
   utilizador) é por `(posted-day, match, team)` — NÃO garante dedup
   cross-day; a defesa fica na aplicação. Não tentar alterar o índice por
   migração (o utilizador teria de aplicar manualmente; desnecessário).
5. **Jogos adiados**: se um jogo passa de 5ª para 6ª feira, a Twin
   re-publica com `scheduled_at` novo → o dedup por dia deixa passar uma
   segunda pick. Aceitável (odds re-preçadas = decisão nova), documentar no
   comentário do código.

## Critérios de aceitação

1. `npx tsc --noEmit` limpo.
2. Limpeza one-off: query de verificação devolve **0 grupos duplicados
   abertos**:
   `select p1_name, p2_name, date(scheduled_at), count(*) from picks where
   result is null group by 1,2,3 having count(*) > 1` (via REST equivalente).
3. Após o próximo ciclo do cron Twin (corre a cada ~2h), a resposta do
   ingest mostra `skipped` > 0 para jogos que já têm pick de ontem, e a
   contagem de picks para o MESMO jogo mantém-se 1.
4. `/picks` deixa de mostrar o mesmo confronto 2× na secção "Por jogar".
