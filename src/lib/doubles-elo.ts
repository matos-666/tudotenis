/**
 * Per-player Doubles ELO updater.
 *
 * Estratégia: cada jogador tem o seu rating de duplas. Para um match,
 *   team_elo = (p1.elo + p2.elo) / 2
 *   expected = 1 / (1 + 10^((opp_team_elo - team_elo) / 400))
 *   delta    = K * (actual - expected)
 *   cada jogador da equipa vencedora ganha +delta
 *   cada jogador da equipa perdedora perde -delta
 *
 * K-factor: 32 base, ajustado por categoria (slam = 40, M1000 = 36, 250 = 28).
 *
 * Updates simultaneamente o ELO overall E o de surface (se conhecida).
 *
 * Nota: actualizamos doubles_matches_count e doubles_matches_24m no mesmo update.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_ELO = 1500;
const BASE_K = 32;

function categoryK(category: string | null): number {
  if (!category) return BASE_K;
  if (category === 'slam') return 40;
  if (category === '1000') return 36;
  if (category === 'finals') return 36;
  if (category === '500') return 32;
  if (category === '250') return 28;
  return 28;
}

function surfaceCol(surface: string | null): 'elo_doubles_hard' | 'elo_doubles_clay' | 'elo_doubles_grass' | 'elo_doubles_indoor' | null {
  if (!surface) return null;
  const s = surface.toLowerCase();
  if (s === 'hard') return 'elo_doubles_hard';
  if (s === 'clay') return 'elo_doubles_clay';
  if (s === 'grass') return 'elo_doubles_grass';
  if (s === 'indoor') return 'elo_doubles_indoor';
  return null;
}

type PlayerDoublesElo = {
  id: number;
  elo_doubles_overall: number | null;
  elo_doubles_hard: number | null;
  elo_doubles_clay: number | null;
  elo_doubles_grass: number | null;
  elo_doubles_indoor: number | null;
  doubles_matches: number | null;
  doubles_matches_24m: number | null;
};

/**
 * Aplica update de ELO doubles para um match já settled.
 * Devolve { ok, error }.
 */
export async function applyDoublesEloUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: SupabaseClient<any, 'public', 'public', any, any>,
  matchId: number
): Promise<{ ok: boolean; error?: string }> {
  // 1. Fetch match
  const { data: m, error: mErr } = await supa
    .from('doubles_matches')
    .select('t1_p1_id, t1_p2_id, t2_p1_id, t2_p2_id, winner_team, surface, tournament_id, date')
    .eq('id', matchId)
    .single();
  if (mErr || !m) return { ok: false, error: mErr?.message ?? 'match not found' };
  if (m.winner_team == null) return { ok: false, error: 'no winner set' };
  const ids = [m.t1_p1_id, m.t1_p2_id, m.t2_p1_id, m.t2_p2_id];
  if (ids.some(x => x == null)) return { ok: false, error: 'missing player id' };

  // 2. Fetch tournament category for K-factor
  let category: string | null = null;
  if (m.tournament_id) {
    const { data: t } = await supa
      .from('tournaments')
      .select('category')
      .eq('id', m.tournament_id)
      .single();
    category = t?.category ?? null;
  }
  const K = categoryK(category);
  const surfCol = surfaceCol(m.surface);

  // 3. Fetch all 4 players
  const { data: players, error: pErr } = await supa
    .from('players')
    .select('id, elo_doubles_overall, elo_doubles_hard, elo_doubles_clay, elo_doubles_grass, elo_doubles_indoor, doubles_matches, doubles_matches_24m')
    .in('id', ids);
  if (pErr || !players || players.length !== 4) {
    return { ok: false, error: pErr?.message ?? `expected 4 players, got ${players?.length ?? 0}` };
  }
  const byId = new Map<number, PlayerDoublesElo>(players.map(p => [p.id as number, p as PlayerDoublesElo]));
  const t1p1 = byId.get(m.t1_p1_id!);
  const t1p2 = byId.get(m.t1_p2_id!);
  const t2p1 = byId.get(m.t2_p1_id!);
  const t2p2 = byId.get(m.t2_p2_id!);
  if (!t1p1 || !t1p2 || !t2p1 || !t2p2) return { ok: false, error: 'player lookup mismatch' };

  // 4. Compute team ELOs (overall)
  const get = (p: PlayerDoublesElo, key: keyof PlayerDoublesElo) => Number(p[key] ?? DEFAULT_ELO);
  const t1Overall = (get(t1p1, 'elo_doubles_overall') + get(t1p2, 'elo_doubles_overall')) / 2;
  const t2Overall = (get(t2p1, 'elo_doubles_overall') + get(t2p2, 'elo_doubles_overall')) / 2;
  const exp1 = 1 / (1 + Math.pow(10, (t2Overall - t1Overall) / 400));
  const actual1 = m.winner_team === 1 ? 1 : 0;
  const delta = K * (actual1 - exp1);

  // Same calc for surface, if known
  let surfDelta = 0;
  if (surfCol) {
    const t1Surf = (get(t1p1, surfCol) + get(t1p2, surfCol)) / 2;
    const t2Surf = (get(t2p1, surfCol) + get(t2p2, surfCol)) / 2;
    const expSurf = 1 / (1 + Math.pow(10, (t2Surf - t1Surf) / 400));
    surfDelta = K * (actual1 - expSurf);
  }

  // 5. Apply updates
  // Cada jogador da equipa 1 ganha +delta (overall) e +surfDelta (surface).
  // Cada jogador da equipa 2 perde -delta.
  // Counters bumped for all 4.
  const updates: Array<{ id: number; teamSign: 1 | -1 }> = [
    { id: t1p1.id, teamSign: 1 },
    { id: t1p2.id, teamSign: 1 },
    { id: t2p1.id, teamSign: -1 },
    { id: t2p2.id, teamSign: -1 },
  ];

  for (const u of updates) {
    const p = byId.get(u.id)!;
    const patch: Record<string, number> = {
      elo_doubles_overall: get(p, 'elo_doubles_overall') + u.teamSign * delta,
      doubles_matches: (p.doubles_matches ?? 0) + 1,
      doubles_matches_24m: (p.doubles_matches_24m ?? 0) + 1,
    };
    if (surfCol) {
      patch[surfCol] = get(p, surfCol) + u.teamSign * surfDelta;
    }
    // Round to 1 decimal
    for (const k of Object.keys(patch)) {
      if (typeof patch[k] === 'number') patch[k] = Math.round(patch[k] * 10) / 10;
    }

    const { error: updErr } = await supa.from('players').update(patch).eq('id', u.id);
    if (updErr) return { ok: false, error: updErr.message };
  }

  return { ok: true };
}
