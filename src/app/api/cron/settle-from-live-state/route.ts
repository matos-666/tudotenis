/**
 * Settler alternativo que usa live_state.final_winner como fonte de
 * verdade em vez de scrape TennisStats.
 *
 * O settler original (daily_settle.yml) faz scrape ao TennisStats para
 * matches finished, mas em Slams como Wimbledon o TennisStats está a
 * devolver empty (bloqueio/mudança de layout). Como já capturamos
 * final_winner via cron live-state (SR match_get), aproveitamos esses
 * dados para marcar as pre-match picks correspondentes.
 *
 * Auth: Bearer CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

const supabase = getServiceSupabase();

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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

  return NextResponse.json({
    ok: true,
    ms: Date.now() - t0,
    finished_matches_seen: finished.length,
    open_picks_seen: openPicks.length,
    settled,
    voided_unknown_selection: voidedUnknown,
    errors: errors.slice(0, 5),
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
