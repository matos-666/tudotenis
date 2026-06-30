'use client';

/**
 * Renderer client-side da curva P(vence match) live.
 *
 * Duas linhas (uma por jogador) + hover/touch tooltip com score por
 * snapshot. Bandas alternadas por set + marcadores de fim de set +
 * tracks pequenos para cada jogo. Adapta-se a mobile via SVG fluído
 * + touch handlers.
 */
import { useMemo, useState } from 'react';

export interface ChartRow {
  captured_at: string;
  match_win_prob_a: number;
  set_a: number;
  set_b: number;
  game_a: number;
  game_b: number;
  point_importance: number | null;
  tiebreak: boolean;
}

interface Props {
  rows: ChartRow[];
  nameA: string;
  nameB: string;
}

const WIDTH = 720;
const HEIGHT = 280;
const PAD = { top: 22, right: 16, bottom: 52, left: 36 };

export default function LiveWinProbChartView({ rows, nameA, nameB }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const view = useMemo(() => {
    const t0 = new Date(rows[0].captured_at).getTime();
    const tEnd = new Date(rows[rows.length - 1].captured_at).getTime();
    const span = Math.max(1, tEnd - t0);
    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / span) * plotW;
    const y = (p: number) => PAD.top + (1 - p) * plotH;

    const xys = rows.map(r => ({
      t: new Date(r.captured_at).getTime(),
      pA: r.match_win_prob_a,
      pB: 1 - r.match_win_prob_a,
      r,
    }));
    const pathA = xys.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.pA).toFixed(1)}`).join(' ');
    const pathB = xys.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.pB).toFixed(1)}`).join(' ');

    type SetMarker = { tMs: number; winner: 'A' | 'B'; score: string };
    const setMarkers: SetMarker[] = [];
    const gameMarkers: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const setChanged = cur.set_a > prev.set_a || cur.set_b > prev.set_b;
      const gameChanged = cur.game_a !== prev.game_a || cur.game_b !== prev.game_b;
      if (setChanged) {
        setMarkers.push({
          tMs: new Date(cur.captured_at).getTime(),
          winner: cur.set_a > prev.set_a ? 'A' : 'B',
          score: `${cur.set_a}-${cur.set_b}`,
        });
      } else if (gameChanged) {
        gameMarkers.push(new Date(cur.captured_at).getTime());
      }
    }
    type SetLabel = { startMs: number; endMs: number; num: number };
    const setLabels: SetLabel[] = [];
    let segStart = t0;
    let setNum = 1;
    for (const m of setMarkers) {
      setLabels.push({ startMs: segStart, endMs: m.tMs, num: setNum });
      segStart = m.tMs;
      setNum++;
    }
    setLabels.push({ startMs: segStart, endMs: tEnd, num: setNum });

    return { t0, tEnd, span, plotW, plotH, x, y, xys, pathA, pathB, setMarkers, gameMarkers, setLabels };
  }, [rows]);

  function eventToIndex(clientX: number, currentTarget: SVGSVGElement): number {
    const rect = currentTarget.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const svgX = (cssX / rect.width) * WIDTH;
    const tHover = view.t0 + ((svgX - PAD.left) / view.plotW) * view.span;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < view.xys.length; i++) {
      const d = Math.abs(view.xys[i].t - tHover);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    setHoverIdx(eventToIndex(e.clientX, e.currentTarget));
  };
  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 0) return;
    setHoverIdx(eventToIndex(e.touches[0].clientX, e.currentTarget));
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  const last = view.xys[view.xys.length - 1];
  const lastPctA = Math.round(last.pA * 100);
  const lastPctB = 100 - lastPctA;
  const durMin = Math.round(view.span / 60000);

  const hover = hoverIdx != null ? view.xys[hoverIdx] : null;
  const hoverX = hover ? view.x(hover.t) : 0;
  const hoverYA = hover ? view.y(hover.pA) : 0;
  const hoverYB = hover ? view.y(hover.pB) : 0;
  const hoverPctA = hover ? Math.round(hover.pA * 100) : 0;
  const hoverPctB = hover ? 100 - hoverPctA : 0;
  const hoverScore = hover
    ? `${hover.r.set_a}-${hover.r.set_b} · ${hover.r.tiebreak ? 'TB' : `${hover.r.game_a}-${hover.r.game_b}`}`
    : '';

  const shortA = nameA.split(',')[0];
  const shortB = nameB.split(',')[0];

  return (
    <div className="stat-card p-4 md:p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-gray-400">P(vence match) · evolução</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {rows.length} snapshots · {durMin} min
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-[var(--color-accent)]" />
            <span className="text-gray-300">{shortA} <span className="font-mono">{lastPctA}%</span></span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 border-t border-dashed border-gray-400" />
            <span className="text-gray-300">{shortB} <span className="font-mono">{lastPctB}%</span></span>
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`Probabilidade de vitória ao longo do match entre ${shortA} e ${shortB}`}
        className="block touch-pan-y"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={handleTouchMove}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => setHoverIdx(null)}
      >
        {/* Y axis grid */}
        {yTicks.map(t => (
          <g key={`ytick-${t}`}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={view.y(t)}
              y2={view.y(t)}
              stroke="currentColor"
              strokeOpacity={t === 0.5 ? 0.25 : 0.10}
              strokeDasharray={t === 0.5 ? undefined : '2 3'}
              className="text-gray-400"
            />
            <text
              x={PAD.left - 6}
              y={view.y(t) + 3}
              fontSize="10"
              textAnchor="end"
              fill="currentColor"
              className="text-gray-500"
            >
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* Bandas alternadas por set */}
        {view.setLabels.map((s, i) => {
          if (s.endMs <= s.startMs) return null;
          const xa = view.x(s.startMs);
          const xb = view.x(s.endMs);
          if (xb - xa < 4) return null;
          return (
            <rect
              key={`setband-${i}`}
              x={xa}
              y={PAD.top}
              width={xb - xa}
              height={HEIGHT - PAD.top - PAD.bottom}
              fill="currentColor"
              fillOpacity={i % 2 === 0 ? 0 : 0.04}
              className="text-gray-400"
            />
          );
        })}

        {/* Tracks de game no eixo X */}
        {view.gameMarkers.map((t, i) => (
          <line
            key={`gm-${i}`}
            x1={view.x(t)}
            x2={view.x(t)}
            y1={HEIGHT - PAD.bottom - 4}
            y2={HEIGHT - PAD.bottom + 2}
            stroke="currentColor"
            strokeOpacity={0.30}
            strokeWidth={1}
            className="text-gray-400"
          />
        ))}

        {/* Marcadores de fim de set */}
        {view.setMarkers.map((m, i) => (
          <g key={`sm-${i}`}>
            <line
              x1={view.x(m.tMs)}
              x2={view.x(m.tMs)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom + 6}
              stroke="currentColor"
              strokeOpacity={0.55}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              className="text-gray-400"
            />
            <text
              x={view.x(m.tMs)}
              y={PAD.top - 6}
              fontSize="9"
              textAnchor="middle"
              fill="currentColor"
              className="text-gray-500"
              fontWeight="600"
            >
              {m.score}
            </text>
          </g>
        ))}

        {/* Labels Set N */}
        {view.setLabels.map((s, i) => {
          if (s.endMs <= s.startMs) return null;
          const xa = view.x(s.startMs);
          const xb = view.x(s.endMs);
          if (xb - xa < 30) return null;
          return (
            <text
              key={`sl-${i}`}
              x={(xa + xb) / 2}
              y={HEIGHT - PAD.bottom + 18}
              fontSize="10"
              textAnchor="middle"
              fill="currentColor"
              fontWeight="600"
              className="text-gray-500"
            >
              Set {s.num}
            </text>
          );
        })}

        {/* Linha B (jogador B), tracejada */}
        <path
          d={view.pathB}
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-gray-400"
        />

        {/* Linha A (jogador A), accent */}
        <path
          d={view.pathA}
          stroke="var(--color-accent)"
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots última snapshot */}
        <circle
          cx={view.x(last.t)}
          cy={view.y(last.pA)}
          r={4}
          fill="var(--color-accent)"
          stroke="var(--color-surface)"
          strokeWidth={2}
        />
        <circle
          cx={view.x(last.t)}
          cy={view.y(last.pB)}
          r={3}
          fill="currentColor"
          fillOpacity={0.55}
          stroke="var(--color-surface)"
          strokeWidth={2}
          className="text-gray-400"
        />

        {/* Hover guide */}
        {hover && (
          <g pointerEvents="none">
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="currentColor"
              strokeOpacity={0.45}
              strokeWidth={1}
              className="text-gray-400"
            />
            <circle cx={hoverX} cy={hoverYA} r={4} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={1.5} />
            <circle cx={hoverX} cy={hoverYB} r={3.5} fill="currentColor" className="text-gray-400" stroke="var(--color-surface)" strokeWidth={1.5} />
            {(() => {
              const TT_W = 150;
              const TT_H = 56;
              const margin = 8;
              let tx = hoverX + margin;
              if (tx + TT_W > WIDTH - PAD.right) tx = hoverX - margin - TT_W;
              const ty = Math.max(PAD.top, Math.min(hoverYA - TT_H - 8, HEIGHT - PAD.bottom - TT_H));
              return (
                <g transform={`translate(${tx},${ty})`}>
                  <rect
                    width={TT_W}
                    height={TT_H}
                    rx={6}
                    fill="var(--color-surface)"
                    stroke="var(--color-border)"
                  />
                  <text x={8} y={14} fontSize="10" fill="currentColor" className="text-gray-400" fontWeight="600">
                    {hoverScore}
                  </text>
                  <text x={8} y={30} fontSize="11" fill="var(--color-accent)" fontWeight="700">
                    {shortA} {hoverPctA}%
                  </text>
                  <text x={8} y={46} fontSize="11" fill="currentColor" className="text-gray-300" fontWeight="600">
                    {shortB} {hoverPctB}%
                  </text>
                </g>
              );
            })()}
          </g>
        )}
      </svg>

      <p className="text-[11px] text-gray-500 mt-2">
        Hover ou passa o dedo para ver probabilidades em cada momento.
      </p>
    </div>
  );
}
