'use client';

/**
 * LiveWinProbChartView — nova apresentação da evolução do match.
 *
 * Desenho pensado para legibilidade máxima:
 *
 *  1. UMA linha do modelo (P do jogador A). A posição vs 50% diz quem
 *     lidera — não precisamos da linha espelhada do adversário (era
 *     redundante e criava o "X" confuso). O fundo é dividido em duas
 *     zonas coloridas: acima de 50% pertence ao jogador A, abaixo ao B,
 *     cada uma com o nome esbatido lá dentro.
 *
 *  2. Linha do MERCADO (prob implícita das odds Twin, de-vigada). O gap
 *     vertical entre modelo e mercado É o nosso edge — quando o verde
 *     está acima do cinza, o modelo vê valor no A.
 *
 *  3. Marcadores das PICKS no instante em que saíram, à altura da prob
 *     do modelo nesse momento, coloridos por resultado (win/loss/aberto)
 *     com tooltip de odd + EV + grade.
 *
 * Mantém: break-moment dedup (server), set bands, hover/touch, viewBox
 * responsivo mobile/desktop.
 */
import { useEffect, useMemo, useState } from 'react';

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

export interface OddsPoint {
  captured_at: string;
  odd_a: number | null;
  odd_b: number | null;
}

export interface PickPoint {
  posted_at: string;
  selection: 'A' | 'B' | string;
  live_odd: number | null;
  edge_pct: number | null;
  grade: string | null;
  result: 'win' | 'loss' | 'void' | null;
}

interface Props {
  rows: ChartRow[];
  odds: OddsPoint[];
  picks: PickPoint[];
  nameA: string;
  nameB: string;
}

const DESKTOP = { W: 760, H: 300, PAD: { top: 24, right: 18, bottom: 52, left: 40 } };
const MOBILE = { W: 420, H: 380, PAD: { top: 22, right: 14, bottom: 56, left: 34 } };

export default function LiveWinProbChartView({ rows, odds, picks, nameA, nameB }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const { W: WIDTH, H: HEIGHT, PAD } = isMobile ? MOBILE : DESKTOP;

  const view = useMemo(() => {
    const t0 = new Date(rows[0].captured_at).getTime();
    const tEnd = new Date(rows[rows.length - 1].captured_at).getTime();
    const span = Math.max(1, tEnd - t0);
    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / span) * plotW;
    const y = (p: number) => PAD.top + (1 - p) * plotH;
    const clampX = (t: number) => Math.max(PAD.left, Math.min(WIDTH - PAD.right, x(t)));

    // Série do modelo
    const modelPts = rows.map(r => ({
      t: new Date(r.captured_at).getTime(),
      p: r.match_win_prob_a,
      r,
    }));
    const modelPath = modelPts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`)
      .join(' ');
    // Área preenchida até 50% (destaca quando A está acima/abaixo)
    const areaPath =
      `M${x(modelPts[0].t).toFixed(1)},${y(0.5).toFixed(1)} ` +
      modelPts.map(p => `L${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ') +
      ` L${x(modelPts[modelPts.length - 1].t).toFixed(1)},${y(0.5).toFixed(1)} Z`;

    // Série do mercado (prob implícita de-vigada), só dentro do span
    const mktPts: Array<{ t: number; p: number }> = [];
    for (const o of odds) {
      const oa = o.odd_a != null ? Number(o.odd_a) : null;
      const ob = o.odd_b != null ? Number(o.odd_b) : null;
      if (oa == null || ob == null || oa <= 1 || ob <= 1) continue;
      const t = new Date(o.captured_at).getTime();
      if (t < t0 - 60_000 || t > tEnd + 60_000) continue;
      const inv = 1 / oa + 1 / ob;
      mktPts.push({ t, p: (1 / oa) / inv });
    }
    const mktPath = mktPts.length >= 2
      ? mktPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${clampX(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ')
      : null;

    // Set-end markers + labels
    type SetMarker = { tMs: number; score: string };
    const setMarkers: SetMarker[] = [];
    const gameMarkers: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (cur.set_a > prev.set_a || cur.set_b > prev.set_b) {
        setMarkers.push({ tMs: new Date(cur.captured_at).getTime(), score: `${cur.set_a}-${cur.set_b}` });
      } else if (cur.game_a !== prev.game_a || cur.game_b !== prev.game_b) {
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

    // Picks: interpola a prob do modelo no instante da pick p/ posicionar
    const modelProbAt = (t: number): number => {
      if (t <= modelPts[0].t) return modelPts[0].p;
      if (t >= modelPts[modelPts.length - 1].t) return modelPts[modelPts.length - 1].p;
      for (let i = 1; i < modelPts.length; i++) {
        if (modelPts[i].t >= t) {
          const a = modelPts[i - 1], b = modelPts[i];
          const f = (t - a.t) / Math.max(1, b.t - a.t);
          return a.p + (b.p - a.p) * f;
        }
      }
      return modelPts[modelPts.length - 1].p;
    };
    const pickMarks = picks
      .map(pk => {
        const t = new Date(pk.posted_at).getTime();
        if (t < t0 - 60_000 || t > tEnd + 60_000) return null;
        return { t, cx: clampX(t), cy: y(modelProbAt(t)), pk };
      })
      .filter((x): x is { t: number; cx: number; cy: number; pk: PickPoint } => x !== null);

    return {
      t0, tEnd, span, plotW, plotH, x, y, modelPts, modelPath, areaPath,
      mktPath, mktPts, setMarkers, gameMarkers, setLabels, pickMarks,
    };
  }, [rows, odds, picks, WIDTH, HEIGHT, PAD]);

  function eventToIndex(clientX: number, target: SVGSVGElement): number {
    const rect = target.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH;
    const tHover = view.t0 + ((svgX - PAD.left) / view.plotW) * view.span;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < view.modelPts.length; i++) {
      const d = Math.abs(view.modelPts[i].t - tHover);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const last = view.modelPts[view.modelPts.length - 1];
  const lastPctA = Math.round(last.p * 100);
  const durMin = Math.round(view.span / 60000);
  const shortA = nameA.split(',')[0].trim();
  const shortB = nameB.split(',')[0].trim();

  const hover = hoverIdx != null ? view.modelPts[hoverIdx] : null;
  const hoverX = hover ? view.x(hover.t) : 0;
  const hoverY = hover ? view.y(hover.p) : 0;
  const hoverPctA = hover ? Math.round(hover.p * 100) : 0;
  const hoverScore = hover
    ? `${hover.r.set_a}-${hover.r.set_b} · ${hover.r.tiebreak ? 'TB' : `${hover.r.game_a}-${hover.r.game_b}`}`
    : '';

  const resultColor = (r: PickPoint['result']) =>
    r === 'win' ? 'var(--color-accent)' : r === 'loss' ? '#ef4444' : '#eab308';

  return (
    <div className="stat-card p-4 md:p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-gray-400">Evolução do favoritismo</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{rows.length} momentos · {durMin} min</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-[3px] rounded bg-[var(--color-accent)]" />
            <span className="text-gray-300">Modelo</span>
          </span>
          {view.mktPath && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-gray-400" />
              <span className="text-gray-400">Mercado</span>
            </span>
          )}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`Evolução da probabilidade entre ${shortA} e ${shortB}`}
        className="block touch-pan-y select-none"
        onMouseMove={(e) => setHoverIdx(eventToIndex(e.clientX, e.currentTarget))}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={(e) => e.touches[0] && setHoverIdx(eventToIndex(e.touches[0].clientX, e.currentTarget))}
        onTouchMove={(e) => e.touches[0] && setHoverIdx(eventToIndex(e.touches[0].clientX, e.currentTarget))}
        onTouchEnd={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="zoneA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Zonas: metade de cima do A (accent), metade de baixo do B (índigo) */}
        <rect x={PAD.left} y={PAD.top} width={WIDTH - PAD.left - PAD.right} height={(HEIGHT - PAD.top - PAD.bottom) / 2}
          fill="var(--color-accent)" fillOpacity={0.05} />
        <rect x={PAD.left} y={PAD.top + (HEIGHT - PAD.top - PAD.bottom) / 2} width={WIDTH - PAD.left - PAD.right} height={(HEIGHT - PAD.top - PAD.bottom) / 2}
          fill="#6366f1" fillOpacity={0.06} />

        {/* Nome de cada jogador na sua zona (favorito/underdog) */}
        <text x={PAD.left + 8} y={PAD.top + 15} fontSize="11" fontWeight="700" fill="var(--color-accent)" fillOpacity={0.75}>
          {shortA} favorito
        </text>
        <text x={PAD.left + 8} y={HEIGHT - PAD.bottom - 7} fontSize="11" fontWeight="700" fill="#818cf8" fillOpacity={0.85}>
          {shortB} favorito
        </text>

        {/* Grid Y */}
        {yTicks.map(t => (
          <g key={`yt-${t}`}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={view.y(t)} y2={view.y(t)}
              stroke="currentColor" strokeOpacity={t === 0.5 ? 0.35 : 0.08}
              strokeWidth={t === 0.5 ? 1.5 : 1}
              strokeDasharray={t === 0.5 ? undefined : '2 3'} className="text-gray-400" />
            <text x={PAD.left - 6} y={view.y(t) + 3} fontSize="9.5" textAnchor="end" fill="currentColor" className="text-gray-500">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* Bandas alternadas por set + game ticks */}
        {view.setLabels.map((s, i) => {
          if (s.endMs <= s.startMs) return null;
          const xa = view.x(s.startMs), xb = view.x(s.endMs);
          if (xb - xa < 4) return null;
          return (
            <g key={`sb-${i}`}>
              {i % 2 === 1 && (
                <rect x={xa} y={PAD.top} width={xb - xa} height={HEIGHT - PAD.top - PAD.bottom}
                  fill="currentColor" fillOpacity={0.03} className="text-gray-500" />
              )}
              {xb - xa >= 30 && (
                <text x={(xa + xb) / 2} y={HEIGHT - PAD.bottom + 18} fontSize="10" textAnchor="middle"
                  fontWeight="600" fill="currentColor" className="text-gray-500">
                  Set {s.num}
                </text>
              )}
            </g>
          );
        })}
        {view.gameMarkers.map((t, i) => (
          <line key={`g-${i}`} x1={view.x(t)} x2={view.x(t)} y1={HEIGHT - PAD.bottom - 3} y2={HEIGHT - PAD.bottom + 2}
            stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} className="text-gray-400" />
        ))}
        {view.setMarkers.map((m, i) => (
          <g key={`sm-${i}`}>
            <line x1={view.x(m.tMs)} x2={view.x(m.tMs)} y1={PAD.top} y2={HEIGHT - PAD.bottom + 6}
              stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="3 3" className="text-gray-400" />
            <text x={view.x(m.tMs)} y={PAD.top - 6} fontSize="9" textAnchor="middle" fontWeight="600"
              fill="currentColor" className="text-gray-500">{m.score}</text>
          </g>
        ))}

        {/* Área do modelo até 50% */}
        <path d={view.areaPath} fill="url(#zoneA)" />

        {/* Linha do mercado (tracejada, por trás) */}
        {view.mktPath && (
          <path d={view.mktPath} stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.5}
            strokeDasharray="5 3" fill="none" strokeLinejoin="round" strokeLinecap="round" className="text-gray-400" />
        )}

        {/* Linha do modelo (accent, à frente) */}
        <path d={view.modelPath} stroke="var(--color-accent)" strokeWidth={2.5} fill="none"
          strokeLinejoin="round" strokeLinecap="round" />

        {/* Marcadores de picks */}
        {view.pickMarks.map((m, i) => {
          const col = resultColor(m.pk.result);
          return (
            <g key={`pk-${i}`}>
              <line x1={m.cx} x2={m.cx} y1={PAD.top} y2={HEIGHT - PAD.bottom}
                stroke={col} strokeOpacity={0.28} strokeWidth={1} />
              <circle cx={m.cx} cy={m.cy} r={5} fill={col} stroke="var(--color-surface)" strokeWidth={2}>
                <title>{`Pick ${m.pk.selection === 'A' ? shortA : shortB} @${m.pk.live_odd ?? '?'} · EV ${m.pk.edge_pct != null ? (m.pk.edge_pct > 0 ? '+' : '') + m.pk.edge_pct.toFixed(1) + '%' : '—'} · grade ${m.pk.grade ?? '?'} · ${m.pk.result ?? 'aberto'}`}</title>
              </circle>
            </g>
          );
        })}

        {/* Dot final */}
        <circle cx={view.x(last.t)} cy={view.y(last.p)} r={4} fill="var(--color-accent)"
          stroke="var(--color-surface)" strokeWidth={2} />

        {/* Hover */}
        {hover && (
          <g pointerEvents="none">
            <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={HEIGHT - PAD.bottom}
              stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} className="text-gray-400" />
            <circle cx={hoverX} cy={hoverY} r={4.5} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={1.5} />
            {(() => {
              const TT_W = 168, TT_H = 62, margin = 8;
              let tx = hoverX + margin;
              if (tx + TT_W > WIDTH - PAD.right) tx = hoverX - margin - TT_W;
              const ty = Math.max(PAD.top, Math.min(hoverY - TT_H - 6, HEIGHT - PAD.bottom - TT_H));
              return (
                <g transform={`translate(${tx},${ty})`}>
                  <rect width={TT_W} height={TT_H} rx={7} fill="var(--color-surface)" stroke="var(--color-border)" />
                  <text x={9} y={15} fontSize="10" fill="currentColor" className="text-gray-400" fontWeight="600">{hoverScore}</text>
                  <text x={9} y={33} fontSize="12" fill="var(--color-accent)" fontWeight="700">{shortA} {hoverPctA}%</text>
                  <text x={9} y={50} fontSize="12" fill="#818cf8" fontWeight="700">{shortB} {100 - hoverPctA}%</text>
                </g>
              );
            })()}
          </g>
        )}
      </svg>

      {/* Legenda dos marcadores de picks + resumo actual */}
      <div className="flex items-center justify-between gap-3 mt-2 flex-wrap text-[11px]">
        <div className="flex items-center gap-3">
          <span className="text-gray-400">
            Agora: <span className="font-mono font-bold text-[var(--color-accent)]">{shortA} {lastPctA}%</span>
            <span className="text-gray-500"> · {shortB} {100 - lastPctA}%</span>
          </span>
        </div>
        {view.pickMarks.length > 0 && (
          <div className="flex items-center gap-2.5 text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--color-accent)' }} /> win</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#ef4444' }} /> loss</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#eab308' }} /> pick aberta</span>
          </div>
        )}
      </div>
      <p className="text-[11px] text-gray-500 mt-1.5">
        A linha verde é a nossa probabilidade; a tracejada é o mercado. O intervalo entre as duas é o nosso edge.
      </p>
    </div>
  );
}
