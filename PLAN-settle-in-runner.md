# PLAN: Settlement no runner (liquidação garantida, sem dependências externas)

## Objectivo

A liquidação de picks (pré-live + live) depende hoje de DUAS coisas frágeis:

1. O endpoint `/api/cron/settle-from-live-state` ser chamado pelo
   **cron-job.org a cada 30 min** — job cuja criação foi pedida ao
   utilizador mas **nunca confirmada**. Se não existir, picks órfãs
   acumulam (aconteceu: 15 de 16 live picks estavam órfãs a 06-07).
2. O `settleMatch` inline no poll (`src/lib/live-poll.ts`) só liquida se o
   cron apanhar a iteração exacta da transição running→ended.

Mover a chamada do settlement para DENTRO do loop do runner
(`scripts/poll-live.ts`), que já corre de 4 em 4 horas durante 5.5h. Assim
a liquidação é garantida pela mesma infraestrutura do polling, sem
invocations Vercel (que custam Fluid CPU — limite 4h/mês) e sem depender
de um job externo não confirmado.

## Ficheiros a tocar

1. `src/lib/settle-core.ts` (novo — lógica extraída do route)
2. `src/app/api/cron/settle-from-live-state/route.ts` (vira wrapper fino)
3. `scripts/poll-live.ts` (chama o settle a cada N iterações)

## Passos, por ordem

### Passo 1 — Extrair a lógica para `src/lib/settle-core.ts`

Copiar `src/app/api/cron/settle-from-live-state/route.ts` para
`src/lib/settle-core.ts` e transformar (MESMO padrão usado em
`src/lib/live-poll.ts` e `src/lib/live-odds-core.ts` no commit `a51795b` —
usar esses ficheiros como referência de estilo):

- Remover `import { NextRequest, NextResponse } from 'next/server'`.
- Remover `export const dynamic` e `export const maxDuration`.
- Renomear o corpo do `POST` para:
  ```ts
  export interface SettleResult {
    ms: number;
    finished_matches_seen: number;
    open_picks_seen: number;
    settled: number;
    voided_unknown_selection: number;
    live_open_seen: number;
    live_settled: number;
    live_orphan_no_odd_deleted: number;
    errors: string[];
  }
  export async function settleFromLiveState(): Promise<SettleResult> { ... }
  ```
- Dentro, apagar o bloco de auth (`req.headers.get('authorization')`) — a
  auth pertence ao wrapper HTTP, não à lógica.
- Trocar os `return NextResponse.json({...})` por `return {...}` simples.
- Apagar o `export async function GET`.

### Passo 2 — Route vira wrapper

Reescrever `src/app/api/cron/settle-from-live-state/route.ts` (usar
`src/app/api/cron/live-state/route.ts` como modelo — é um wrapper de 26
linhas):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { settleFromLiveState } from '@/lib/settle-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const r = await settleFromLiveState();
  return NextResponse.json({ ok: true, ...r });
}

export async function GET(req: NextRequest) { return POST(req); }
```

### Passo 3 — Chamar do loop do runner

Em `scripts/poll-live.ts`:

3a. O ficheiro usa **dynamic import DEPOIS do dotenv config** (ver
comentário no próprio ficheiro — os imports estáticos são hoisted e correm
antes do config, deixando o supabase client sem env). Adicionar ao bloco de
dynamic imports no `main()`:

```ts
  const { settleFromLiveState } = await import('@/lib/settle-core');
```

3b. Dentro do `while`, depois do bloco do `pollOnce`, adicionar:

```ts
    // Settlement a cada 10 iterações (~5 min com INTERVAL 30s). Varre
    // picks órfãs pré-live E live cujos matches já têm final_winner —
    // safety-net que não depende de cron externo nem de invocations
    // Vercel.
    if (iter % 10 === 0) {
      try {
        const s = await settleFromLiveState();
        if (s.settled > 0 || s.live_settled > 0) {
          console.log(`  settle: prelive=${s.settled} live=${s.live_settled} orphan_deleted=${s.live_orphan_no_odd_deleted}`);
        }
      } catch (e) {
        console.error('  settle err:', (e as Error).message.slice(0, 120));
      }
    }
```

### Passo 4 — Typecheck + teste local + commit

```bash
npx tsc --noEmit -p .
# Teste: 1 ciclo com settle forçado (mudar temporariamente iter % 10 para
# iter % 1, correr, reverter):
POLL_RUNTIME_MS=35000 POLL_INTERVAL_MS=30000 npx tsx scripts/poll-live.ts
git add -A && git commit && git push
```

## Edge cases (não saltar)

1. **Concorrência com o `settleMatch` inline do `pollOnce`**: os dois podem
   correr no mesmo processo em iterações próximas. É seguro — ambos operam
   com `WHERE result IS NULL` / `is('result', null)`, portanto o segundo a
   chegar encontra 0 rows. Não adicionar locks.
2. **O settle demora ~7s** (medido em produção: `ms:7616` com backlog).
   Numa iteração com settle, o ciclo pode exceder os 30s de INTERVAL — o
   loop já lida com isso (`sleep` só se `> 0`), mas o log de iteração
   nessa volta vem atrasado. Aceitável; não "optimizar".
3. **dotenv/hoisting**: se o import do `settle-core` for estático no topo
   do script, o `createClient` inicializa com URL vazio e rebenta com
   `supabaseUrl is required`. Foi exactamente o bug apanhado ao criar o
   `poll-live.ts` — manter o padrão de dynamic import.
4. **Não apagar o job do cron-job.org se ele existir** — redundância barata
   (o endpoint é idempotente). Mas o runner passa a ser a garantia primária.
5. **Fora das janelas do runner** (~0h30-3h da manhã se houver gaps): picks
   que terminem aí só liquidam no início da janela seguinte. Aceitável —
   nenhum match de ténis relevante do nosso scope acaba sem que uma janela
   apanhe o `final_winner` que já está gravado na `live_state`.

## Critérios de aceitação

1. `npx tsc --noEmit` limpo.
2. `settle-from-live-state/route.ts` tem <35 linhas (wrapper) e importa de
   `@/lib/settle-core`.
3. Teste local do script mostra a linha `settle: prelive=X live=Y` (com
   `iter % 1` temporário) sem erro de env/supabase.
4. POST manual ao endpoint em produção continua a responder 200 com o mesmo
   shape de resposta de antes (compatibilidade com o job cron-job.org, se
   existir).
5. Query de auditoria 24h depois do deploy: `select count(*) from
   live_picks p where p.result is null and exists (select 1 from live_state s
   where s.sr_match_id = p.sr_match_id and s.match_finished = true and
   s.final_winner is not null)` → **0 rows** (zero órfãs persistentes).
