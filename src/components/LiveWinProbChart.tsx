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

/**
 * Filtra snapshots para break moments (1 ponto por estado único de
 * set+game). Razão: snapshots intra-game introduzem spikes
 * transientes que não representam o "valor real" do modelo — o que
 * conta é a probabilidade no fim de cada game/set, que é também o
 * único momento onde emitimos picks. Mantém sempre a última snapshot
 * (mesmo que do mesmo estado) para refletir o momento "agora".
 */
function dedupeToBreakMoments(rows: ChartRow[]): ChartRow[] {
  if (rows.length === 0) return rows;
  // Para cada estado único (set_a, set_b, game_a, game_b, tiebreak)
  // ficamos com a ÚLTIMA snapshot — esse é o valor "estabilizado" antes
  // do próximo estado. Guardar a primeira capturaria spikes transientes
  // (ex.: set point que volta logo a baixar). Rows entram em ordem ASC,
  // por isso reescrever a Map por chave dá automaticamente a última.
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
  const raw = await fetchSnapshots(srMatchId);
  const rows = dedupeToBreakMoments(raw);
  if (rows.length < 2) {
    return (
      <div className="stat-card p-6 text-center text-sm text-gray-500">
        Aguardando snapshots suficientes para desenhar curva.
      </div>
    );
  }
  return <LiveWinProbChartView rows={rows} nameA={nameA} nameB={nameB} />;
}
