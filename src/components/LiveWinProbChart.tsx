/**
 * LiveWinProbChart — server wrapper. Busca snapshots de live_state e
 * passa para o renderer client (com hover/touch interactivity).
 */
import { supabase } from '@/lib/supabase';
import LiveWinProbChartView, { type ChartRow } from './LiveWinProbChartView';

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

export async function LiveWinProbChart({ srMatchId, nameA, nameB }: Props) {
  const rows = await fetchSnapshots(srMatchId);
  if (rows.length < 2) {
    return (
      <div className="stat-card p-6 text-center text-sm text-gray-500">
        Aguardando snapshots suficientes para desenhar curva.
      </div>
    );
  }
  return <LiveWinProbChartView rows={rows} nameA={nameA} nameB={nameB} />;
}
