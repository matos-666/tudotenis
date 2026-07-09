/**
 * Núcleo do settlement via live_state.final_winner — fonte de verdade
 * em vez de scrape TennisStats (que devolve empty em Slams).
 *
 * Liquida: (1) pre-match picks por match de nomes normalizados;
 * (2) live_picks órfãs por comparação directa selection vs final_winner.
 *
 * Extraído do endpoint Vercel para correr TAMBÉM no runner do GitHub
 * Actions (scripts/poll-live.ts chama a cada ~5 min) — a liquidação fica
 * garantida pela mesma infra do polling, sem invocations Vercel e sem
 * depender de cron externo. O endpoint /api/cron/settle-from-live-state
 * importa daqui e mantém-se como fallback/manual. Uma fonte de verdade.
 */
import { getServiceSupabase } from '@/lib/supabase';

const supabase = getServiceSupabase();

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

interface FinishedMatch {
  name_a: string;
  name_b: string;
  final_winner: 'A' | 'B';
  final_score: string | null;
}

interface OpenPick {
  id: number;
  p1_name: string | null;
  p2_name: string | null;
  selection: string;
  odd: number;
  stake: number;
  posted_at: string;
}

// 'Michelsen, Alex' (SR) → 'Alex Michelsen' (players.name)
function srNameToPickName(src: string): string {
  const idx = src.indexOf(',');
  if (idx < 0) return src.trim();
  return `${src.slice(idx + 1).trim()} ${src.slice(0, idx).trim()}`;
}

function normalize(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

async function fetchFinishedMatches(): Promise<FinishedMatch[]> {
  const { data } = await supabase
    .from('live_state')
    .select('name_a, name_b, final_winner, final_score')
    .eq('match_finished', true)
    .not('final_winner', 'is', null)
    .not('name_a', 'is', null)
    .not('name_b', 'is', null)
    .limit(2000);
  // Dedupe por (name_a, name_b) — múltiplas snapshots para o mesmo match
  const seen = new Set<string>();
  const out: FinishedMatch[] = [];
  for (const r of (data ?? []) as FinishedMatch[]) {
    const k = `${r.name_a}|${r.name_b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

async function fetchOpenPicks(): Promise<OpenPick[]> {
  const { data } = await supabase
    .from('picks')
    .select('id, p1_name, p2_name, selection, odd, stake, posted_at')
    .is('result', null)
    .not('p1_name', 'is', null)
    .not('p2_name', 'is', null)
    .limit(2000);
  return (data ?? []) as OpenPick[];
}

export async function settleFromLiveState(): Promise<SettleResult> {
  const t0 = Date.now();
  const [finished, openPicks] = await Promise.all([fetchFinishedMatches(), fetchOpenPicks()]);

  // Índice de finished por par normalizado {norm(nameA), norm(nameB)} (unordered)
  const finishedIndex = new Map<string, FinishedMatch>();
  for (const f of finished) {
    const nA = normalize(srNameToPickName(f.name_a));
    const nB = normalize(srNameToPickName(f.name_b));
    // Registra ambas as ordens para lookup independente da ordem no pick
    const key1 = [nA, nB].sort().join('|');
    finishedIndex.set(key1, f);
  }

  let settled = 0;
  let voidedUnknown = 0;
  const errors: string[] = [];

  for (const p of openPicks) {
    const p1n = normalize(p.p1_name!);
    const p2n = normalize(p.p2_name!);
    const key = [p1n, p2n].sort().join('|');
    const match = finishedIndex.get(key);
    if (!match) continue;

    // Determinar quem ganhou nos nomes do pick
    const winnerSrName = match.final_winner === 'A' ? match.name_a : match.name_b;
    const winnerNorm = normalize(srNameToPickName(winnerSrName));

    // 'selection' na tabela picks é o nome do jogador em quem apostámos
    // (ex.: 'Iga Swiatek'). Comparamos normalized com winner.
    const selectionNorm = normalize(p.selection);
    let result: 'win' | 'loss' | 'void' = 'void';
    if (selectionNorm === winnerNorm) result = 'win';
    else if (selectionNorm === p1n || selectionNorm === p2n) result = 'loss';
    else {
      voidedUnknown++;
      errors.push(`pick#${p.id} selection='${p.selection}' not matching p1='${p.p1_name}' nor p2='${p.p2_name}'`);
      continue;
    }

    const odd = Number(p.odd);
    const stake = Number(p.stake);
    const pl = result === 'win' ? +(stake * (odd - 1)).toFixed(2) : result === 'loss' ? -stake : 0;

    const { error } = await supabase
      .from('picks')
      .update({ result, pl, settled_at: new Date().toISOString() })
      .eq('id', p.id);
    if (error) errors.push(`pick#${p.id} update err: ${error.message}`);
    else settled++;
  }

  // ── Live picks órfãs ──────────────────────────────────────────────────
  // O settleMatch no cron live-state só liquida na iteração exacta em que
  // apanha a transição running→ended. Se o match acaba entre janelas do
  // cron ou já saiu da lista de candidatos, a pick fica aberta para
  // sempre. Aqui varremos as live_picks abertas e liquidamos qualquer
  // uma cujo match tem final_winner gravado em live_state — safety-net
  // que garante que NENHUMA entrada live fica por liquidar.
  let liveSettled = 0;
  let liveOrphanNoOdd = 0;
  const { data: openLive } = await supabase
    .from('live_picks')
    .select('id, sr_match_id, selection, live_odd, stake')
    .is('result', null)
    .limit(2000);

  const liveMatchIds = [...new Set((openLive ?? []).map(p => p.sr_match_id as number))];
  const winnerByMatch = new Map<number, 'A' | 'B'>();
  if (liveMatchIds.length > 0) {
    // Fetch final_winner por match (dedupe: qualquer snapshot serve)
    const { data: fw } = await supabase
      .from('live_state')
      .select('sr_match_id, final_winner')
      .in('sr_match_id', liveMatchIds)
      .eq('match_finished', true)
      .not('final_winner', 'is', null)
      .limit(4000);
    for (const r of (fw ?? []) as Array<{ sr_match_id: number; final_winner: 'A' | 'B' }>) {
      if (!winnerByMatch.has(r.sr_match_id)) winnerByMatch.set(r.sr_match_id, r.final_winner);
    }
  }

  const nowIso = new Date().toISOString();
  for (const p of openLive ?? []) {
    const winner = winnerByMatch.get(p.sr_match_id as number);
    if (!winner) continue; // match ainda a decorrer — deixa aberta
    // Sem odd = pick nunca foi apostável; apaga em vez de liquidar
    // (mantém a política do emit: nasce-completa-ou-não-nasce).
    if (p.live_odd == null) {
      await supabase.from('live_picks').delete().eq('id', p.id);
      liveOrphanNoOdd++;
      continue;
    }
    const won = (p.selection as 'A' | 'B') === winner;
    const odd = Number(p.live_odd);
    const stake = Number(p.stake ?? 1);
    const pl = won ? +(stake * (odd - 1)).toFixed(2) : -stake;
    const { error } = await supabase
      .from('live_picks')
      .update({ result: won ? 'win' : 'loss', pl, settled_at: nowIso })
      .eq('id', p.id);
    if (error) errors.push(`live_pick#${p.id} err: ${error.message}`);
    else liveSettled++;
  }

  return {
    ms: Date.now() - t0,
    finished_matches_seen: finished.length,
    open_picks_seen: openPicks.length,
    settled,
    voided_unknown_selection: voidedUnknown,
    live_open_seen: (openLive ?? []).length,
    live_settled: liveSettled,
    live_orphan_no_odd_deleted: liveOrphanNoOdd,
    errors: errors.slice(0, 5),
  };
}
