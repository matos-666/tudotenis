/**
 * poll-live.ts — loop de polling live que corre NO RUNNER do GitHub
 * Actions (grátis, ilimitado em repos públicos), escrevendo direto no
 * Supabase. Substitui o loop antigo que batia em Vercel functions a
 * cada 15-30s — isso consumia ~60h/mês de Fluid Active CPU num plano
 * Hobby com limite de 4h, e desactivou o deployment (402).
 *
 * A lógica é a MESMA dos endpoints Vercel (importada de @/lib), por
 * isso não há divergência: pollOnce (Sportradar → modelo → live_state
 * + picks) e ingestTwinOdds (odds Twin → live_odds_history + attach).
 *
 * Corre com: npx tsx scripts/poll-live.ts
 * Env necessárias: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * CRON_SECRET (usado indiretamente pelos libs). Localmente vêm do
 * .env.local; no runner vêm dos GitHub secrets.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { execFileSync } from 'node:child_process';
// IMPORTANTE: só type-imports estáticos aqui. As funções vêm de import
// DINÂMICO dentro do main(), depois do config() carregar as env vars —
// senão o @/lib/supabase inicializa o createClient com URL vazio (os
// imports ES são hoisted e correm antes do config()).
import type { IngestPayload } from '@/lib/live-odds-core';

const RUNTIME_MS = Number(process.env.POLL_RUNTIME_MS ?? 5.5 * 3600 * 1000);
const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);

function scrapeTwin(): IngestPayload | null {
  try {
    const out = execFileSync('node', ['scripts/scrape-twin-live.mjs'], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    }).toString();
    return JSON.parse(out) as IngestPayload;
  } catch (e) {
    console.error('  scrape err:', (e as Error).message.slice(0, 120));
    return null;
  }
}

async function main() {
  // Dynamic import DEPOIS do config() — garante env vars carregadas
  // antes do @/lib/supabase inicializar o createClient.
  const { pollOnce } = await import('@/lib/live-poll');
  const { ingestTwinOdds } = await import('@/lib/live-odds-core');

  const end = Date.now() + RUNTIME_MS;
  let iter = 0;
  let okOdds = 0, okState = 0, failOdds = 0, failState = 0;
  console.log(`poll-live start · runtime ${(RUNTIME_MS / 3600000).toFixed(1)}h · interval ${INTERVAL_MS / 1000}s`);

  while (Date.now() < end) {
    const cycleStart = Date.now();
    iter++;

    // ── Twin odds ──────────────────────────────────────────────
    const twin = scrapeTwin();
    let oddsRes: Awaited<ReturnType<typeof ingestTwinOdds>> | null = null;
    if (twin) {
      try { oddsRes = await ingestTwinOdds(twin); okOdds++; }
      catch (e) { failOdds++; console.error('  odds err:', (e as Error).message.slice(0, 120)); }
    }

    // ── Sportradar state + modelo + picks ──────────────────────
    let stateRes: Awaited<ReturnType<typeof pollOnce>> | null = null;
    try { stateRes = await pollOnce(); okState++; }
    catch (e) { failState++; console.error('  state err:', (e as Error).message.slice(0, 120)); }

    if (iter % 10 === 0 || iter <= 3) {
      const t = new Date().toISOString().slice(11, 19);
      console.log(`[${t}] iter=${iter} odds=${oddsRes ? `m${oddsRes.matched}/u${oddsRes.picks_updated}` : '—'} state=${stateRes ? `run${stateRes.running}/pk${stateRes.picks}/st${stateRes.settled}` : '—'}`);
    }

    const elapsed = Date.now() - cycleStart;
    const sleep = INTERVAL_MS - elapsed;
    if (sleep > 0) await new Promise(r => setTimeout(r, sleep));
  }

  console.log(`\n═══ poll-live done ═══`);
  console.log(`iterations: ${iter}`);
  console.log(`odds:  ok=${okOdds} fail=${failOdds}`);
  console.log(`state: ok=${okState} fail=${failState}`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
