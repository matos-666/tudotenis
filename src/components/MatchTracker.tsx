'use client';

/**
 * Live match tracker — 3D court SVG + bouncing ball no servidor + animações
 * centrais quando o estado muda (point, game, set, ace, DF, break).
 *
 * Polling: 15s contra /api/live-state/[matchId]. Compara snapshots para
 * detectar transições. Não depende do revalidate da page-mãe.
 */
import { useEffect, useRef, useState } from 'react';

interface LiveState {
  set_a: number;
  set_b: number;
  game_a: number;
  game_b: number;
  point_a: number;
  point_b: number;
  server: 'A' | 'B' | null;
  tiebreak: boolean;
  aces_a: number | null;
  aces_b: number | null;
  df_a: number | null;
  df_b: number | null;
  match_finished: boolean;
  final_winner: 'A' | 'B' | null;
}

interface Props {
  matchId: number;
  initial: LiveState;
  nameA: string;
  nameB: string;
}

type Side = 'A' | 'B';
type EventKind =
  | { kind: 'point'; side: Side }
  | { kind: 'game'; side: Side }
  | { kind: 'break'; side: Side }
  | { kind: 'set'; side: Side; setA: number; setB: number }
  | { kind: 'ace'; side: Side }
  | { kind: 'df'; side: Side }
  | { kind: 'match'; side: Side };

function formatPoint(pt: number, isTb: boolean, ad: Side | null, side: Side): string {
  if (isTb) return String(pt);
  if (ad === side) return 'AD';
  if (ad && ad !== side) return '40';
  const labels = ['0', '15', '30', '40'];
  return labels[pt] ?? String(pt);
}

function detectEvent(prev: LiveState, curr: LiveState): EventKind | null {
  if (curr.match_finished && !prev.match_finished && curr.final_winner) {
    return { kind: 'match', side: curr.final_winner };
  }
  if (curr.set_a > prev.set_a) return { kind: 'set', side: 'A', setA: curr.set_a, setB: curr.set_b };
  if (curr.set_b > prev.set_b) return { kind: 'set', side: 'B', setA: curr.set_a, setB: curr.set_b };
  // Game change → check if it was a break (server was the OTHER side)
  if (curr.game_a > prev.game_a) {
    if (prev.server === 'B') return { kind: 'break', side: 'A' };
    return { kind: 'game', side: 'A' };
  }
  if (curr.game_b > prev.game_b) {
    if (prev.server === 'A') return { kind: 'break', side: 'B' };
    return { kind: 'game', side: 'B' };
  }
  // Stats deltas (acabaram de adicionar ace/df)
  if ((curr.aces_a ?? 0) > (prev.aces_a ?? 0)) return { kind: 'ace', side: 'A' };
  if ((curr.aces_b ?? 0) > (prev.aces_b ?? 0)) return { kind: 'ace', side: 'B' };
  if ((curr.df_a ?? 0) > (prev.df_a ?? 0)) return { kind: 'df', side: 'A' };
  if ((curr.df_b ?? 0) > (prev.df_b ?? 0)) return { kind: 'df', side: 'B' };
  // Point change
  if (curr.point_a > prev.point_a) return { kind: 'point', side: 'A' };
  if (curr.point_b > prev.point_b) return { kind: 'point', side: 'B' };
  return null;
}

function eventLabel(ev: EventKind, lastA: string, lastB: string): { primary: string; secondary?: string; color: string } {
  const winnerName = ev.side === 'A' ? lastA : lastB;
  switch (ev.kind) {
    case 'point':
      return { primary: '+1', secondary: winnerName, color: 'accent' };
    case 'game':
      return { primary: 'GAME', secondary: winnerName, color: 'accent' };
    case 'break':
      return { primary: 'BREAK!', secondary: winnerName, color: 'red' };
    case 'set':
      return { primary: 'SET', secondary: `${winnerName} · ${ev.setA}-${ev.setB}`, color: 'accent' };
    case 'ace':
      return { primary: 'ACE', secondary: winnerName, color: 'accent' };
    case 'df':
      return { primary: 'DUPLA FALTA', secondary: winnerName, color: 'red' };
    case 'match':
      return { primary: 'MATCH', secondary: `${winnerName} venceu`, color: 'accent' };
  }
}

export function MatchTracker({ matchId, initial, nameA, nameB }: Props) {
  const [state, setState] = useState<LiveState>(initial);
  const [event, setEvent] = useState<EventKind | null>(null);
  const prevRef = useRef<LiveState>(initial);
  const eventTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/live-state/${matchId}`, { cache: 'no-store' });
        if (!r.ok) return;
        const fresh = (await r.json()) as LiveState | null;
        if (!fresh || cancelled) return;
        const detected = detectEvent(prevRef.current, fresh);
        if (detected) {
          setEvent(detected);
          if (eventTimerRef.current) window.clearTimeout(eventTimerRef.current);
          eventTimerRef.current = window.setTimeout(() => setEvent(null), 3500);
        }
        prevRef.current = fresh;
        setState(fresh);
      } catch {
        /* network blip; next tick will retry */
      }
    };
    const handle = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
      if (eventTimerRef.current) window.clearTimeout(eventTimerRef.current);
    };
  }, [matchId]);

  // Detect advantage state
  let adSide: Side | null = null;
  if (!state.tiebreak && state.point_a >= 3 && state.point_b >= 3) {
    if (state.point_a > state.point_b) adSide = 'A';
    else if (state.point_b > state.point_a) adSide = 'B';
  }
  const ptA = formatPoint(state.point_a, state.tiebreak, adSide, 'A');
  const ptB = formatPoint(state.point_b, state.tiebreak, adSide, 'B');

  const lastA = nameA.split(',')[0].trim();
  const lastB = nameB.split(',')[0].trim();
  const server = state.server;

  return (
    <div className="stat-card p-4 md:p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-sm uppercase tracking-wider text-gray-400">
          Live tracker {state.tiebreak && <span className="text-yellow-400">· tiebreak</span>}
        </h2>
        {server && (
          <span className="text-[11px] text-gray-500">
            Serve: <span className="text-[var(--color-accent)] font-semibold">{server === 'A' ? lastA : lastB}</span>
          </span>
        )}
      </div>

      {/* Court arena com perspective 3D + overlay de animação */}
      <div className="relative" style={{ perspective: '900px', perspectiveOrigin: '50% 30%' }}>
        <svg
          viewBox="0 0 600 280"
          width="100%"
          role="img"
          aria-label={`Court ${lastA} vs ${lastB}`}
          className="block max-h-[280px]"
          style={{
            transform: 'rotateX(50deg) translateY(8px)',
            transformOrigin: 'center 70%',
          }}
        >
          {/* GRASS ground (slightly darker rim) */}
          <rect x="0" y="0" width="600" height="280" fill="#1f5d2a" />

          {/* OUTER COURT (doubles) */}
          <rect x="40" y="40" width="520" height="200" fill="#2c8a3d" stroke="#ffffff" strokeWidth="3" />

          {/* SINGLES SIDELINES (indented from doubles by ~10%) */}
          <line x1="40" y1="60" x2="560" y2="60" stroke="#ffffff" strokeWidth="2" />
          <line x1="40" y1="220" x2="560" y2="220" stroke="#ffffff" strokeWidth="2" />

          {/* SERVICE LINES (21ft from net, ratio ~0.27 of half-court) */}
          <line x1="180" y1="60" x2="180" y2="220" stroke="#ffffff" strokeWidth="2" />
          <line x1="420" y1="60" x2="420" y2="220" stroke="#ffffff" strokeWidth="2" />

          {/* CENTER SERVICE LINE (inside service boxes only) */}
          <line x1="180" y1="140" x2="420" y2="140" stroke="#ffffff" strokeWidth="2" />

          {/* CENTER MARK on baselines */}
          <line x1="40" y1="135" x2="40" y2="145" stroke="#ffffff" strokeWidth="3" />
          <line x1="560" y1="135" x2="560" y2="145" stroke="#ffffff" strokeWidth="3" />

          {/* NET — drawn as gradient bar com pattern de rede */}
          <defs>
            <pattern id="net-pattern" width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="#f0f0f0" fillOpacity="0.4" />
              <path d="M0 0L6 6M6 0L0 6" stroke="#ffffff" strokeWidth="0.6" strokeOpacity="0.7" />
            </pattern>
          </defs>
          <rect x="296" y="30" width="8" height="220" fill="url(#net-pattern)" stroke="#ffffff" strokeWidth="1.5" />
          {/* Net top band */}
          <rect x="294" y="28" width="12" height="6" fill="#ffffff" />

          {/* BOUNCING BALL no lado do servidor — visível só se server known */}
          {server && (
            <g>
              <ellipse
                cx={server === 'A' ? 130 : 470}
                cy={state.tiebreak ? 140 : 170}
                rx="14" ry="5"
                fill="rgba(0,0,0,0.35)"
              >
                <animate
                  attributeName="rx"
                  values="14;7;14"
                  dur="0.7s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.35;0.55;0.35"
                  dur="0.7s"
                  repeatCount="indefinite"
                />
              </ellipse>
              <circle
                r="7"
                fill="#e4ff7a"
                stroke="#b8e000"
                strokeWidth="1"
                cx={server === 'A' ? 130 : 470}
              >
                <animate
                  attributeName="cy"
                  values={state.tiebreak ? '140;105;140' : '170;130;170'}
                  dur="0.7s"
                  repeatCount="indefinite"
                  keyTimes="0;0.5;1"
                  keySplines="0.2 0 0.8 1;0.2 0 0.8 1"
                  calcMode="spline"
                />
                <animate
                  attributeName="r"
                  values="7;6;7"
                  dur="0.7s"
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          )}
        </svg>

        {/* Score baseline (não rotacionado — sempre legível) */}
        <div className="flex items-baseline justify-between mt-2 px-2 font-mono text-sm">
          <div className="text-left">
            <div className="font-bold">{lastA}</div>
            <div className="text-gray-400 text-xs">{state.set_a} · {state.game_a} · {ptA}</div>
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">sets · games · points</div>
          <div className="text-right">
            <div className="font-bold">{lastB}</div>
            <div className="text-gray-400 text-xs">{state.set_b} · {state.game_b} · {ptB}</div>
          </div>
        </div>

        {/* OVERLAY ANIMAÇÃO de evento */}
        {event && (() => {
          const { primary, secondary, color } = eventLabel(event, lastA, lastB);
          const colorClass =
            color === 'red'
              ? 'bg-red-500/20 border-red-500/60 text-red-300'
              : 'bg-[var(--color-accent)]/20 border-[var(--color-accent)]/60 text-[var(--color-accent)]';
          return (
            <div
              key={`${event.kind}-${event.side}-${Date.now()}`}
              className={`absolute inset-x-0 top-[35%] flex flex-col items-center justify-center pointer-events-none animate-event-flash`}
            >
              <div className={`px-6 py-3 rounded-xl border-2 backdrop-blur-sm ${colorClass}`}>
                <div className="text-3xl md:text-5xl font-extrabold tracking-tight text-center">{primary}</div>
                {secondary && (
                  <div className="text-xs md:text-sm font-semibold text-center mt-1 opacity-90">{secondary}</div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* CSS keyframes inline (escopadas via classe única) */}
      <style jsx>{`
        @keyframes eventFlash {
          0%   { opacity: 0; transform: scale(0.6); }
          15%  { opacity: 1; transform: scale(1.15); }
          25%  { transform: scale(1); }
          75%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.05); }
        }
        :global(.animate-event-flash) {
          animation: eventFlash 3.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}
