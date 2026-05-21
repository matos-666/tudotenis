/**
 * H2HSparklineCompare — server wrapper que faz fetch das séries ELO 12m
 * dos 2 jogadores e delega o render (com tooltip interactivo) ao client
 * component H2HSparklineCompareView.
 *
 * Fonte: elo_history. Prefere set-level (Phase C, fresco via cron daily)
 * com fallback match-level legacy.
 */
import { supabase } from '@/lib/supabase';
import { H2HSparklineCompareView } from './H2HSparklineCompareView';

interface PlayerLite {
  id: number;
  name: string;
  flag: string | null;
  photo_url: string | null;
}

interface HistoryRow {
  player_id: number;
  date: string;
  elo_overall: number | null;
  elo_set_overall: number | null;
}

export async function H2HSparklineCompare({
  p1,
  p2,
}: {
  p1: PlayerLite;
  p2: PlayerLite;
}) {
  // Janela: últimos 12 meses
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('elo_history')
    .select('player_id, date, elo_overall, elo_set_overall')
    .in('player_id', [p1.id, p2.id])
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error) {
    console.error('[H2HSparklineCompare]', error.message);
    return null;
  }

  const rows = (data ?? []) as HistoryRow[];

  // Para cada jogador, prefere set-level (≥2 pontos), fallback legacy
  function buildSeries(pid: number): { date: string; value: number }[] {
    const setPts: { date: string; value: number }[] = [];
    const legPts: { date: string; value: number }[] = [];
    for (const r of rows) {
      if (r.player_id !== pid) continue;
      const setV = r.elo_set_overall;
      const legV = r.elo_overall;
      if (setV != null && setV > 800 && setV < 3000) {
        setPts.push({ date: r.date, value: Number(setV) });
      }
      if (legV != null && legV > 800 && legV < 3000) {
        legPts.push({ date: r.date, value: Number(legV) });
      }
    }
    return setPts.length >= 2 ? setPts : legPts;
  }

  const s1 = buildSeries(p1.id);
  const s2 = buildSeries(p2.id);

  if (s1.length < 2 || s2.length < 2) return null;

  return <H2HSparklineCompareView p1={p1} p2={p2} s1={s1} s2={s2} />;
}
