/**
 * LiveWinProbChart — evolução da nossa P(A vence match) ao longo
 * do tempo, derivada das snapshots em live_state.
 *
 * Server component, SVG inline, zero JS no cliente (segue convenção
 * do EloChart). Auto-actualiza via `revalidate` da page-mãe.
 *
 * Markers verticais nos finais de set + indicação visual de quem
 * ganhou cada set. Tooltip <title> com score por ponto da curva.
 */
import { supabase } from '@/lib/supabase';

interface Row {
  captured_at: string;
  match_win_prob_a: number | null;
  set_a: number;
  set_b: number;
  game_a: number;
  game_b: number;
  point_importance: number | null;
  tiebreak: boolean;
}

interface Props {
  srMatchId: number;
  nameA: string;
  nameB: string;
}

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 18, right: 16, bottom: 28, left: 36 };

async function fetchSnapshots(srMatchId: number): Promise<Row[]> {
  const { data } = await supabase
    .from('live_state')
    .select('captured_at, match_win_prob_a, set_a, set_b, game_a, game_b, point_importance, tiebreak')
    .eq('sr_match_id', srMatchId)
    .not('match_win_prob_a', 'is', null)
    .order('captured_at', { ascending: true })
    .limit(2000);
  return (data ?? []) as Row[];
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

  const t0 = new Date(rows[0].captured_at).getTime();
  const tEnd = new Date(rows[rows.length - 1].captured_at).getTime();
  const span = Math.max(1, tEnd - t0);

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  function x(t: number): number {
    return PAD.left + ((t - t0) / span) * plotW;
  }
  function y(p: number): number {
    return PAD.top + (1 - p) * plotH;
  }

  const pathOurs = rows
    .map((r, i) => {
      const xi = x(new Date(r.captured_at).getTime());
      const yi = y(r.match_win_prob_a as number);
      return `${i === 0 ? 'M' : 'L'}${xi.toFixed(1)},${yi.toFixed(1)}`;
    })
    .join(' ');

  // Set-end markers: detect when set_a + set_b increments
  type SetMarker = { tMs: number; winner: 'A' | 'B'; score: string };
  const setMarkers: SetMarker[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (cur.set_a > prev.set_a || cur.set_b > prev.set_b) {
      setMarkers.push({
        tMs: new Date(cur.captured_at).getTime(),
        winner: cur.set_a > prev.set_a ? 'A' : 'B',
        score: `${cur.set_a}-${cur.set_b}`,
      });
    }
  }

  // Y axis ticks at 0, 25, 50, 75, 100
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  // Latest point — to draw a dot
  const last = rows[rows.length - 1];
  const lastX = x(new Date(last.captured_at).getTime());
  const lastY = y(last.match_win_prob_a as number);
  const lastPctA = Math.round((last.match_win_prob_a as number) * 100);

  // Duration in minutes
  const durMin = Math.round(span / 60000);

  return (
    <div className="stat-card p-4 md:p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-gray-400">P(vence match) · evolução</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {rows.length} snapshots · {durMin} min · escala {nameA.split(',')[0]} (eixo Y)
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-[var(--color-accent)]" />
            <span className="text-gray-300">{nameA.split(',')[0]} agora <span className="font-mono">{lastPctA}%</span></span>
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`Gráfico da probabilidade de ${nameA} vencer ao longo do match`}
        className="block"
      >
        {/* Background grid */}
        {yTicks.map(t => (
          <g key={`ytick-${t}`}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              strokeOpacity={t === 0.5 ? 0.25 : 0.10}
              strokeDasharray={t === 0.5 ? undefined : '2 3'}
              className="text-gray-400"
            />
            <text
              x={PAD.left - 6}
              y={y(t) + 3}
              fontSize="10"
              textAnchor="end"
              fill="currentColor"
              className="text-gray-500"
            >
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* Set-end markers */}
        {setMarkers.map((m, i) => (
          <g key={`set-${i}`}>
            <line
              x1={x(m.tMs)}
              x2={x(m.tMs)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="currentColor"
              strokeOpacity={0.30}
              strokeDasharray="3 3"
              className="text-gray-400"
            />
            <text
              x={x(m.tMs)}
              y={PAD.top - 4}
              fontSize="9"
              textAnchor="middle"
              fill="currentColor"
              className="text-gray-500"
            >
              {m.score}
            </text>
          </g>
        ))}

        {/* Our line */}
        <path
          d={pathOurs}
          stroke="var(--color-accent)"
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dot for latest snapshot */}
        <circle
          cx={lastX}
          cy={lastY}
          r={4}
          fill="var(--color-accent)"
          stroke="var(--color-surface)"
          strokeWidth={2}
        />

        {/* Invisible hover-target circles with <title> for tooltips */}
        {rows.map((r, i) => {
          if (i % Math.max(1, Math.floor(rows.length / 60)) !== 0 && i !== rows.length - 1) return null;
          const cx = x(new Date(r.captured_at).getTime());
          const cy = y(r.match_win_prob_a as number);
          const pct = Math.round((r.match_win_prob_a as number) * 100);
          const score = `${r.set_a}-${r.set_b} · ${r.tiebreak ? 'TB' : `${r.game_a}-${r.game_b}`}`;
          return (
            <g key={`pt-${i}`}>
              <circle cx={cx} cy={cy} r={6} fill="transparent" stroke="transparent" pointerEvents="all">
                <title>{`${score} · ${pct}% ${nameA.split(',')[0]} · I=${r.point_importance != null ? r.point_importance.toFixed(2) : '—'}`}</title>
              </circle>
            </g>
          );
        })}

        {/* X axis labels: start and now */}
        <text x={PAD.left} y={HEIGHT - 8} fontSize="10" fill="currentColor" className="text-gray-500">
          início
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 8} fontSize="10" textAnchor="end" fill="currentColor" className="text-gray-500">
          agora
        </text>
      </svg>

      <p className="text-[11px] text-gray-500 mt-2">
        Marcadores verticais: finais de set. Passa o rato pela linha para ver detalhes.
      </p>
    </div>
  );
}
