/**
 * H2HSurfaceMiniSparkline — sparkline pequena para colocar dentro de cada
 * card de surface em /h2h/[matchup]. Mostra a trajectória do ELO dos
 * 2 jogadores nessa surface específica nos últimos 12 meses.
 *
 * Server component, sem JS no cliente. Recebe series já fetched (uma
 * query única na page.tsx) para não multiplicar queries.
 *
 * Render: SVG compacto (200×40) sem labels — só linhas + dot final.
 * As cores são p1=accent verde, p2=laranja para consistência com o
 * H2HSparklineCompare overlay.
 */
import type { SurfaceSeriesPair } from '@/lib/h2h-surface-history';

const W = 200;
const H = 40;
const PAD = 2;

const COLOR_P1 = 'var(--color-accent)';
const COLOR_P2 = '#ff9f5c';

export function H2HSurfaceMiniSparkline({
  series,
}: {
  series: SurfaceSeriesPair | undefined;
}) {
  if (!series) return null;
  const { p1, p2 } = series;

  // Precisa de ≥2 pontos por jogador para render
  if (p1.length < 2 || p2.length < 2) return null;

  // Escala Y comum
  let gMin = Infinity;
  let gMax = -Infinity;
  for (const pt of [...p1, ...p2]) {
    if (pt.value < gMin) gMin = pt.value;
    if (pt.value > gMax) gMax = pt.value;
  }
  const span = Math.max(gMax - gMin, 40);
  gMin -= span * 0.08;
  gMax += span * 0.08;
  const yRange = gMax - gMin;

  // Escala X comum (timestamp do primeiro/último ponto da união)
  const allDates = [...p1, ...p2].map(p => p.date).sort();
  const firstTs = new Date(allDates[0]).getTime();
  const lastTs = new Date(allDates[allDates.length - 1]).getTime();
  const xRange = Math.max(1, lastTs - firstTs);

  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  function xPos(dateStr: string): number {
    const t = new Date(dateStr).getTime();
    return PAD + ((t - firstTs) / xRange) * innerW;
  }
  function yPos(value: number): number {
    return PAD + (1 - (value - gMin) / yRange) * innerH;
  }
  function path(pts: { date: string; value: number }[]): string {
    return pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(p.date).toFixed(1)} ${yPos(p.value).toFixed(1)}`)
      .join(' ');
  }

  const lastP1 = p1[p1.length - 1];
  const lastP2 = p2[p2.length - 1];
  const d1 = Math.round(lastP1.value - p1[0].value);
  const d2 = Math.round(lastP2.value - p2[0].value);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-10"
        preserveAspectRatio="none"
        role="img"
        aria-label="Trajectória ELO 12m nesta surface"
      >
        {/* baseline subtil */}
        <line
          x1={PAD}
          x2={W - PAD}
          y1={H / 2}
          y2={H / 2}
          stroke="var(--color-border)"
          strokeWidth="0.4"
          strokeDasharray="1 3"
          opacity="0.5"
          vectorEffect="non-scaling-stroke"
        />
        {/* P1 line */}
        <path
          d={path(p1)}
          fill="none"
          stroke={COLOR_P1}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={xPos(lastP1.date)}
          cy={yPos(lastP1.value)}
          r="2.4"
          fill={COLOR_P1}
        />
        {/* P2 line */}
        <path
          d={path(p2)}
          fill="none"
          stroke={COLOR_P2}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={xPos(lastP2.date)}
          cy={yPos(lastP2.value)}
          r="2.4"
          fill={COLOR_P2}
        />
      </svg>
      <div className="flex items-center justify-between text-[10px] font-mono mt-1">
        <span className={d1 > 5 ? 'text-[var(--color-accent)]' : d1 < -5 ? 'text-red-400' : 'text-gray-500'}>
          P1 {d1 > 0 ? '+' : ''}{d1}
        </span>
        <span className="text-gray-600">12m</span>
        <span
          className={d2 > 5 ? 'text-[var(--color-accent)]' : d2 < -5 ? 'text-red-400' : 'text-gray-500'}
          style={{ color: d2 > 5 ? undefined : d2 < -5 ? undefined : '#9aa3a6' }}
        >
          {d2 > 0 ? '+' : ''}{d2} P2
        </span>
      </div>
    </div>
  );
}
