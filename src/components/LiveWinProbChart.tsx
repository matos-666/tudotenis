/**
 * LiveWinProbChart — server wrapper. Busca snapshots de live_state,
 * odds history e picks do match, e passa ao renderer client.
 */
import { supabase } from '@/lib/supabase';
import LiveWinProbChartView, { type ChartRow, type OddsPoint, type PickPoint } from './LiveWinProbChartView';

interface Props {
  srMatchId: number;
  nameA: string;
  nameB: string;
}

async function fetchSnapshots(srMatchId: number): Promise<ChartRow[]> {
  const { data } = await supabase
    .from('live_state')
    .select('captured_at, match_win_prob_a, set_a, set_b, game_a, game_b, point_importance, tiebreak')
    .eq('sr_match_id', srMatchId)
    .not('match_win_prob_a', 'is', null)
    .order('captured_at', { ascending: true })
    .limit(2000);
  return (data ?? []) as ChartRow[];
}

async function fetchOddsHistory(srMatchId: number): Promise<OddsPoint[]> {
  const { data } = await supabase
    .from('live_odds_history')
    .select('captured_at, odd_a, odd_b')
    .eq('sr_match_id', srMatchId)
    .order('captured_at', { ascending: true })
    .limit(1000);
  return (data ?? []) as OddsPoint[];
}

async function fetchPicks(srMatchId: number): Promise<PickPoint[]> {
  const { data } = await supabase
    .from('live_picks')
    .select('posted_at, selection, live_odd, edge_pct, grade, result')
    .eq('sr_match_id', srMatchId)
    .order('posted_at', { ascending: true })
    .limit(50);
  return (data ?? []) as PickPoint[];
}

/**
 * Filtra snapshots para break moments (1 ponto por estado único de
 * set+game), guardando a ÚLTIMA snapshot de cada estado (valor
 * estabilizado). Mantém o "agora" implícito porque a última snapshot
 * do match é sempre a última do seu estado.
 */
function dedupeToBreakMoments(rows: ChartRow[]): ChartRow[] {
  if (rows.length === 0) return rows;
  const byKey = new Map<string, ChartRow>();
  for (const r of rows) {
    const key = `${r.set_a}-${r.set_b}-${r.game_a}-${r.game_b}-${r.tiebreak ? 1 : 0}`;
    byKey.set(key, r);
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
  );
}

export async function LiveWinProbChart({ srMatchId, nameA, nameB }: Props) {
  const [raw, odds, picks] = await Promise.all([
    fetchSnapshots(srMatchId),
    fetchOddsHistory(srMatchId),
    fetchPicks(srMatchId),
  ]);
  const rows = dedupeToBreakMoments(raw);
  if (rows.length < 2) {
    return (
      <div className="stat-card p-6 text-center text-sm text-gray-500">
        Aguardando snapshots suficientes para desenhar curva.
      </div>
    );
  }
  return <LiveWinProbChartView rows={rows} odds={odds} picks={picks} nameA={nameA} nameB={nameB} />;
}
