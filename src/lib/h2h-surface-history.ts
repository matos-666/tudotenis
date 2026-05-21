/**
 * Helper para H2H — fetch único de history de surface ELO dos 2 jogadores,
 * processado em séries prontas para sparklines.
 *
 * Uma query SQL devolve 12 meses × 2 players × todas as colunas surface,
 * depois fatiamos in-memory por surface, preferindo set-level sobre legacy.
 *
 * Output:
 *   { hard: { p1: [{date,value}], p2: [...] },
 *     clay: { ... },
 *     grass: { ... } }
 */
import { supabase } from '@/lib/supabase';

export interface SurfacePoint {
  date: string;
  value: number;
}
export interface SurfaceSeriesPair {
  p1: SurfacePoint[];
  p2: SurfacePoint[];
}
export type Surface = 'hard' | 'clay' | 'grass';
export type SurfaceHistory = Record<Surface, SurfaceSeriesPair>;

interface Row {
  player_id: number;
  date: string;
  elo_hard: number | null;
  elo_clay: number | null;
  elo_grass: number | null;
  elo_set_hard: number | null;
  elo_set_clay: number | null;
  elo_set_grass: number | null;
}

const SURFACES: Surface[] = ['hard', 'clay', 'grass'];

function validValue(v: number | null | undefined): v is number {
  return v != null && v > 800 && v < 3000;
}

export async function fetchH2HSurfaceHistory(
  p1Id: number,
  p2Id: number,
): Promise<SurfaceHistory | null> {
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('elo_history')
    .select(
      'player_id, date, elo_hard, elo_clay, elo_grass, elo_set_hard, elo_set_clay, elo_set_grass',
    )
    .in('player_id', [p1Id, p2Id])
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error) {
    console.error('[fetchH2HSurfaceHistory]', error.message);
    return null;
  }
  const rows = (data ?? []) as Row[];

  function buildSeries(pid: number, surface: Surface): SurfacePoint[] {
    const setCol = `elo_set_${surface}` as const;
    const legCol = `elo_${surface}` as const;
    const setPts: SurfacePoint[] = [];
    const legPts: SurfacePoint[] = [];
    for (const r of rows) {
      if (r.player_id !== pid) continue;
      const setV = r[setCol];
      const legV = r[legCol];
      if (validValue(setV)) setPts.push({ date: r.date, value: Number(setV) });
      if (validValue(legV)) legPts.push({ date: r.date, value: Number(legV) });
    }
    // Prefere set-level se tiver ≥2 pontos
    return setPts.length >= 2 ? setPts : legPts;
  }

  const result: SurfaceHistory = { hard: { p1: [], p2: [] }, clay: { p1: [], p2: [] }, grass: { p1: [], p2: [] } };
  for (const s of SURFACES) {
    result[s] = {
      p1: buildSeries(p1Id, s),
      p2: buildSeries(p2Id, s),
    };
  }
  return result;
}
