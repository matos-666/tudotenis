'use client';

/**
 * H2HSurfaceMiniSparkline — sparkline pequena dentro de cada card de
 * surface em /h2h/[matchup]. Mostra trajectória do ELO surface dos 2
 * jogadores nos últimos 12 meses.
 *
 * Client component para suportar tooltip interactiva:
 *   - Desktop: hover mostra crosshair + tooltip com ELO de ambos na data
 *   - Mobile: touch sobre o sparkline mostra o mesmo. Levantando o dedo
 *     o tooltip desaparece.
 *
 * touchAction: pan-y permite scroll vertical da página continuar normal
 * mesmo com o dedo no sparkline.
 *
 * Mantém cores consistentes com H2HSparklineCompare (verde p1, laranja p2).
 */
import { useMemo, useRef, useState } from 'react';
import type { SurfaceSeriesPair } from '@/lib/h2h-surface-history';

const W = 200;
const H = 40;
const PAD = 2;

const COLOR_P1 = 'var(--color-accent)';
const COLOR_P2 = '#ff9f5c';

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS_PT[parseInt(m, 10) - 1] ?? m} '${y.slice(2)}`;
}

interface Point { date: string; value: number; ts: number }

export function H2HSurfaceMiniSparkline({
  series,
  p1Name,
  p2Name,
}: {
  series: SurfaceSeriesPair | undefined;
  p1Name?: string;
  p2Name?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number } | null>(null);

  // Pré-cálculo de tudo (memo para evitar refazer em cada render do hover)
  const view = useMemo(() => {
    if (!series) return null;
    const p1Raw = series.p1;
    const p2Raw = series.p2;
    if (p1Raw.length < 2 || p2Raw.length < 2) return null;

    const p1: Point[] = p1Raw.map(p => ({ ...p, ts: new Date(p.date).getTime() }));
    const p2: Point[] = p2Raw.map(p => ({ ...p, ts: new Date(p.date).getTime() }));

    let gMin = Infinity, gMax = -Infinity;
    for (const pt of [...p1, ...p2]) {
      if (pt.value < gMin) gMin = pt.value;
      if (pt.value > gMax) gMax = pt.value;
    }
    const span = Math.max(gMax - gMin, 40);
    gMin -= span * 0.08;
    gMax += span * 0.08;
    const yRange = gMax - gMin;

    const allTs = [...p1.map(p => p.ts), ...p2.map(p => p.ts)].sort((a, b) => a - b);
    const firstTs = allTs[0];
    const lastTs = allTs[allTs.length - 1];
    const xRange = Math.max(1, lastTs - firstTs);

    // Timeline de dates únicas (cruza p1 e p2) para snap
    const dateSet = new Set<string>();
    for (const p of p1) dateSet.add(p.date);
    for (const p of p2) dateSet.add(p.date);
    const timeline = [...dateSet].sort().map(d => ({ date: d, ts: new Date(d).getTime() }));

    return { p1, p2, gMin, gMax, yRange, firstTs, lastTs, xRange, timeline };
  }, [series]);

  if (!view) return null;
  const { p1, p2, gMin, yRange, firstTs, xRange, timeline } = view;

  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  function xPos(ts: number): number {
    return PAD + ((ts - firstTs) / xRange) * innerW;
  }
  function yPos(value: number): number {
    return PAD + (1 - (value - gMin) / yRange) * innerH;
  }
  function path(pts: Point[]): string {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(p.ts).toFixed(1)} ${yPos(p.value).toFixed(1)}`).join(' ');
  }

  const lastP1 = p1[p1.length - 1];
  const lastP2 = p2[p2.length - 1];
  const d1 = Math.round(lastP1.value - p1[0].value);
  const d2 = Math.round(lastP2.value - p2[0].value);

  // Resolução do hover: snap para o ponto da timeline mais próximo
  function handlePointer(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const xRatio = (e.clientX - rect.left) / rect.width;
    const ts = firstTs + xRatio * xRange;
    // Find nearest in timeline
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < timeline.length; i++) {
      const diff = Math.abs(timeline[i].ts - ts);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    setHover({ idx: bestIdx });
  }
  function handleLeave() { setHover(null); }

  // Valor on/before a hover date para cada jogador (último ponto <= hover.ts)
  function valueAt(series: Point[], hoverTs: number): { value: number; date: string } | null {
    let last: Point | null = null;
    for (const p of series) {
      if (p.ts <= hoverTs) last = p;
      else break;
    }
    if (!last) last = series[0]; // se hover é antes do início, mostra primeiro
    return { value: last.value, date: last.date };
  }

  let tooltip: {
    xPct: number;
    date: string;
    p1Value: number | null;
    p2Value: number | null;
  } | null = null;
  if (hover) {
    const hoverPt = timeline[hover.idx];
    const v1 = valueAt(p1, hoverPt.ts);
    const v2 = valueAt(p2, hoverPt.ts);
    tooltip = {
      xPct: (xPos(hoverPt.ts) / W) * 100,
      date: hoverPt.date,
      p1Value: v1?.value ?? null,
      p2Value: v2?.value ?? null,
    };
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-10 cursor-crosshair select-none"
        preserveAspectRatio="none"
        role="img"
        aria-label="Trajectória ELO 12m nesta surface"
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={handleLeave}
        onPointerCancel={handleLeave}
        style={{ touchAction: 'pan-y' }}
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
        {/* Cursor vertical do tooltip */}
        {tooltip && (
          <line
            x1={(tooltip.xPct / 100) * W}
            x2={(tooltip.xPct / 100) * W}
            y1={PAD}
            y2={H - PAD}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        {/* P1 line */}
        <path d={path(p1)} fill="none" stroke={COLOR_P1} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <circle cx={xPos(lastP1.ts)} cy={yPos(lastP1.value)} r="2.4" fill={COLOR_P1} pointerEvents="none" />
        {/* P2 line */}
        <path d={path(p2)} fill="none" stroke={COLOR_P2} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <circle cx={xPos(lastP2.ts)} cy={yPos(lastP2.value)} r="2.4" fill={COLOR_P2} pointerEvents="none" />
      </svg>

      {/* Tooltip flutuante */}
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none -translate-x-1/2 bottom-full mb-1.5 px-2 py-1.5 rounded-md bg-[var(--color-card)] border border-[var(--color-border)] shadow-lg text-[10px] whitespace-nowrap"
          style={{ left: `${Math.min(95, Math.max(5, tooltip.xPct))}%` }}
        >
          <div className="text-gray-400 mb-0.5 font-mono">{fmtShortDate(tooltip.date)}</div>
          {tooltip.p1Value != null && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-0.5" style={{ background: COLOR_P1 }} />
              <span className="text-gray-300 truncate max-w-[80px]">{p1Name ?? 'P1'}</span>
              <span className="font-mono font-bold ml-auto">{Math.round(tooltip.p1Value)}</span>
            </div>
          )}
          {tooltip.p2Value != null && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-0.5" style={{ background: COLOR_P2 }} />
              <span className="text-gray-300 truncate max-w-[80px]">{p2Name ?? 'P2'}</span>
              <span className="font-mono font-bold ml-auto">{Math.round(tooltip.p2Value)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] font-mono mt-1">
        <span className={d1 > 5 ? 'text-[var(--color-accent)]' : d1 < -5 ? 'text-red-400' : 'text-gray-500'}>
          P1 {d1 > 0 ? '+' : ''}{d1}
        </span>
        <span className="text-gray-600">12m</span>
        <span className={d2 > 5 ? 'text-[var(--color-accent)]' : d2 < -5 ? 'text-red-400' : 'text-gray-500'}>
          {d2 > 0 ? '+' : ''}{d2} P2
        </span>
      </div>
    </div>
  );
}
