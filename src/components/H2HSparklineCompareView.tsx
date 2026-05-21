'use client';

/**
 * H2HSparklineCompareView — render-só client component que recebe séries
 * já fetched de H2HSparklineCompare (server). Adiciona crosshair + tooltip
 * interactivo (hover desktop, touch mobile).
 *
 * Separado em ficheiro próprio porque o pai é async server component;
 * client components não podem ser async.
 */
import Image from 'next/image';
import { useMemo, useRef, useState } from 'react';

interface PlayerLite {
  id: number;
  name: string;
  flag: string | null;
  photo_url: string | null;
}

interface Point { date: string; value: number; ts: number }

// SVG layout
const W = 720;
const H = 200;
const PAD_L = 50;
const PAD_R = 18;
const PAD_T = 14;
const PAD_B = 28;

const COLOR_P1 = 'var(--color-accent)';
const COLOR_P2 = '#ff9f5c';

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS_PT[parseInt(m, 10) - 1] ?? m} '${y.slice(2)}`;
}
function fmtMonth(iso: string): string {
  const [y, m] = iso.split('-');
  return `${MONTHS_PT[parseInt(m, 10) - 1] ?? m} '${y.slice(2)}`;
}

function PlayerLegend({
  p,
  color,
  delta,
  eloLast,
}: {
  p: PlayerLite;
  color: string;
  delta: number;
  eloLast: number;
}) {
  const initials = p.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const trendColor =
    delta > 5 ? 'text-[var(--color-accent)]' : delta < -5 ? 'text-red-400' : 'text-gray-400';
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <div className="relative w-9 h-9 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
        {p.photo_url ? (
          <Image src={p.photo_url} alt="" width={72} height={72} className="w-full h-full object-cover" style={{ objectPosition: 'top center' }} unoptimized />
        ) : (
          <span className="text-[10px] font-bold text-gray-500">{initials}</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs md:text-sm font-semibold truncate">
          <span className="inline-block w-3 h-1 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden />
          <span className="truncate">{p.name}</span>
          {p.flag && <span className="text-[10px] text-gray-500 shrink-0">{p.flag}</span>}
        </div>
        <div className={`text-[10px] md:text-xs font-mono ${trendColor}`}>
          {Math.round(eloLast)} · {delta > 0 ? '+' : ''}{delta} em 12m
        </div>
      </div>
    </div>
  );
}

export function H2HSparklineCompareView({
  p1,
  p2,
  s1,
  s2,
}: {
  p1: PlayerLite;
  p2: PlayerLite;
  s1: { date: string; value: number }[];
  s2: { date: string; value: number }[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const view = useMemo(() => {
    const _s1: Point[] = s1.map(p => ({ ...p, ts: new Date(p.date).getTime() }));
    const _s2: Point[] = s2.map(p => ({ ...p, ts: new Date(p.date).getTime() }));

    let gMin = Infinity, gMax = -Infinity;
    for (const pt of [..._s1, ..._s2]) {
      if (pt.value < gMin) gMin = pt.value;
      if (pt.value > gMax) gMax = pt.value;
    }
    const span = Math.max(gMax - gMin, 60);
    gMin -= span * 0.08;
    gMax += span * 0.08;
    const yRange = gMax - gMin;

    const allTs = [..._s1.map(p => p.ts), ..._s2.map(p => p.ts)].sort((a, b) => a - b);
    const firstTs = allTs[0];
    const lastTs = allTs[allTs.length - 1];
    const xRange = Math.max(1, lastTs - firstTs);

    const dateSet = new Set<string>();
    for (const p of _s1) dateSet.add(p.date);
    for (const p of _s2) dateSet.add(p.date);
    const timeline = [...dateSet].sort().map(d => ({ date: d, ts: new Date(d).getTime() }));

    return { s1: _s1, s2: _s2, gMin, gMax, yRange, firstTs, lastTs, xRange, timeline };
  }, [s1, s2]);

  const { s1: P1, s2: P2, gMin, gMax, yRange, firstTs, lastTs, xRange, timeline } = view;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  function xPos(ts: number): number { return PAD_L + ((ts - firstTs) / xRange) * innerW; }
  function yPos(value: number): number { return PAD_T + (1 - (value - gMin) / yRange) * innerH; }
  function path(pts: Point[]): string {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(p.ts).toFixed(1)} ${yPos(p.value).toFixed(1)}`).join(' ');
  }

  const d1 = Math.round(P1[P1.length - 1].value - P1[0].value);
  const d2 = Math.round(P2[P2.length - 1].value - P2[0].value);

  function handlePointer(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    // Mapeia X do cliente para o sistema viewBox (proporcional)
    const xClient = e.clientX - rect.left;
    const xSvg = (xClient / rect.width) * W;
    // Converte para timestamp
    const innerXSvg = Math.max(PAD_L, Math.min(W - PAD_R, xSvg));
    const ts = firstTs + ((innerXSvg - PAD_L) / innerW) * xRange;
    // Snap para timeline
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < timeline.length; i++) {
      const diff = Math.abs(timeline[i].ts - ts);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    setHoverIdx(bestIdx);
  }
  function handleLeave() { setHoverIdx(null); }

  function valueAt(series: Point[], hoverTs: number): number | null {
    let last: Point | null = null;
    for (const p of series) {
      if (p.ts <= hoverTs) last = p;
      else break;
    }
    return last ? last.value : series[0]?.value ?? null;
  }

  let tooltip: { xSvg: number; ySvgP1: number; ySvgP2: number; xPct: number; date: string; v1: number | null; v2: number | null } | null = null;
  if (hoverIdx != null && timeline[hoverIdx]) {
    const ht = timeline[hoverIdx].ts;
    const v1 = valueAt(P1, ht);
    const v2 = valueAt(P2, ht);
    const xs = xPos(ht);
    tooltip = {
      xSvg: xs,
      ySvgP1: v1 != null ? yPos(v1) : 0,
      ySvgP2: v2 != null ? yPos(v2) : 0,
      xPct: (xs / W) * 100,
      date: timeline[hoverIdx].date,
      v1,
      v2,
    };
  }

  const gridY = [0, 0.33, 0.67, 1].map(t => ({
    y: PAD_T + t * innerH,
    label: Math.round(gMax - t * yRange),
  }));

  const firstDateStr = new Date(firstTs).toISOString().slice(0, 10);
  const lastDateStr = new Date(lastTs).toISOString().slice(0, 10);

  return (
    <div className="stat-card p-4 md:p-5 mb-6">
      <h2 className="font-bold text-base md:text-lg flex items-center gap-2 mb-1">
        <span aria-hidden>📈</span>
        <span>Trajectória ELO · últimos 12 meses</span>
      </h2>
      <p className="text-xs text-gray-500 mb-4 max-w-3xl leading-snug">
        Evolução do ELO geral de cada jogador no último ano. Linhas próximas
        = match equilibrado; gap a aumentar = um deles em fase melhor.{' '}
        <span className="text-gray-400">Toca/passa o cursor para ver detalhes.</span>
      </p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <PlayerLegend p={p1} color={COLOR_P1} delta={d1} eloLast={P1[P1.length - 1].value} />
        <PlayerLegend p={p2} color={COLOR_P2} delta={d2} eloLast={P2[P2.length - 1].value} />
      </div>

      <div className="relative overflow-x-auto -mx-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto min-w-[480px] cursor-crosshair select-none"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Trajectória ELO ${p1.name} vs ${p2.name}`}
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={handleLeave}
          onPointerCancel={handleLeave}
          style={{ touchAction: 'pan-y' }}
        >
          {gridY.map((g, i) => (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={g.y} y2={g.y} stroke="var(--color-border)" strokeWidth="1" strokeDasharray={i === gridY.length - 1 ? '' : '2 4'} opacity={i === gridY.length - 1 ? 1 : 0.4} />
              <text x={PAD_L - 6} y={g.y + 3} fontSize="10" fill="#9aa3a6" textAnchor="end" fontFamily="var(--font-mono)">{g.label}</text>
            </g>
          ))}

          <text x={PAD_L} y={H - 10} fontSize="10" fill="#9aa3a6" textAnchor="start">{fmtMonth(firstDateStr)}</text>
          <text x={W - PAD_R} y={H - 10} fontSize="10" fill="#9aa3a6" textAnchor="end">{fmtMonth(lastDateStr)}</text>

          {/* Cursor vertical do tooltip */}
          {tooltip && (
            <>
              <line x1={tooltip.xSvg} x2={tooltip.xSvg} y1={PAD_T} y2={H - PAD_B} stroke="rgba(255,255,255,0.35)" strokeWidth="1" pointerEvents="none" />
              {tooltip.v1 != null && (
                <circle cx={tooltip.xSvg} cy={tooltip.ySvgP1} r="4" fill={COLOR_P1} stroke="var(--color-surface)" strokeWidth="1.5" pointerEvents="none" />
              )}
              {tooltip.v2 != null && (
                <circle cx={tooltip.xSvg} cy={tooltip.ySvgP2} r="4" fill={COLOR_P2} stroke="var(--color-surface)" strokeWidth="1.5" pointerEvents="none" />
              )}
            </>
          )}

          {/* Linhas + dots finais */}
          <path d={path(P1)} fill="none" stroke={COLOR_P1} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
          <circle cx={xPos(P1[P1.length - 1].ts)} cy={yPos(P1[P1.length - 1].value)} r="3" fill={COLOR_P1} stroke="var(--color-surface)" strokeWidth="1.5" pointerEvents="none" />

          <path d={path(P2)} fill="none" stroke={COLOR_P2} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
          <circle cx={xPos(P2[P2.length - 1].ts)} cy={yPos(P2[P2.length - 1].value)} r="3" fill={COLOR_P2} stroke="var(--color-surface)" strokeWidth="1.5" pointerEvents="none" />
        </svg>

        {/* Tooltip flutuante */}
        {tooltip && (
          <div
            className="absolute z-10 pointer-events-none -translate-x-1/2 px-2.5 py-1.5 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] shadow-lg text-[11px] whitespace-nowrap"
            style={{
              left: `${Math.min(95, Math.max(5, tooltip.xPct))}%`,
              top: 0,
            }}
          >
            <div className="text-gray-400 mb-1 font-mono">{fmtShortDate(tooltip.date)}</div>
            {tooltip.v1 != null && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-0.5" style={{ background: COLOR_P1 }} />
                <span className="text-gray-300 truncate max-w-[110px]">{p1.name}</span>
                <span className="font-mono font-bold ml-auto">{Math.round(tooltip.v1)}</span>
              </div>
            )}
            {tooltip.v2 != null && (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-0.5" style={{ background: COLOR_P2 }} />
                <span className="text-gray-300 truncate max-w-[110px]">{p2.name}</span>
                <span className="font-mono font-bold ml-auto">{Math.round(tooltip.v2)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-500 mt-2 leading-snug">
        Snapshots mensais set-level (fallback match-level se ainda em backfill).
        Eixo Y partilhado para os 2 jogadores.
      </p>
    </div>
  );
}
