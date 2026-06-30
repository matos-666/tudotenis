/**
 * Tracker visual proprietário — substitui o widget Sportradar betradar
 * cuja licença free expira por match. Server-component SVG inline.
 *
 * Mostra:
 *   - Court SVG estilizado (visão top-down) com indicador do servidor
 *   - Score grid (sets prévios + set actual)
 *   - Game point state (15-30-40, ad-in/out, tiebreak)
 */

interface Props {
  nameA: string;
  nameB: string;
  setA: number;
  setB: number;
  gameA: number;
  gameB: number;
  pointA: number;
  pointB: number;
  server: 'A' | 'B' | null;
  tiebreak: boolean;
}

function formatPoint(pt: number, isTb: boolean, ad: 'A' | 'B' | null, side: 'A' | 'B'): string {
  if (isTb) return String(pt);
  if (ad === side) return 'AD';
  if (ad && ad !== side) return '40';
  const labels = ['0', '15', '30', '40'];
  return labels[pt] ?? String(pt);
}

export function MatchTracker({
  nameA, nameB, setA, setB, gameA, gameB, pointA, pointB, server, tiebreak,
}: Props) {
  // Detect advantage state em deuce
  let adSide: 'A' | 'B' | null = null;
  if (!tiebreak && pointA >= 3 && pointB >= 3) {
    if (pointA > pointB) adSide = 'A';
    else if (pointB > pointA) adSide = 'B';
  }
  const ptDispA = formatPoint(pointA, tiebreak, adSide, 'A');
  const ptDispB = formatPoint(pointB, tiebreak, adSide, 'B');

  const lastA = nameA.split(',')[0].trim();
  const lastB = nameB.split(',')[0].trim();

  return (
    <div className="stat-card p-4 md:p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-sm uppercase tracking-wider text-gray-400">
          Live tracker {tiebreak && <span className="text-yellow-400">· tiebreak</span>}
        </h2>
        {server && (
          <span className="text-[11px] text-gray-500">
            Serve: <span className="text-[var(--color-accent)] font-semibold">{server === 'A' ? lastA : lastB}</span>
          </span>
        )}
      </div>

      {/* Court SVG */}
      <svg
        viewBox="0 0 480 200"
        width="100%"
        role="img"
        aria-label={`Court ${lastA} vs ${lastB}`}
        className="block max-h-[220px]"
      >
        {/* Outer court */}
        <rect x="20" y="20" width="440" height="160" fill="var(--color-grass-bg)" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" rx="2" />
        {/* Net */}
        <line x1="240" y1="20" x2="240" y2="180" stroke="currentColor" strokeWidth="3" strokeOpacity="0.6" />
        {/* Service boxes */}
        <line x1="20" y1="100" x2="100" y2="100" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
        <line x1="100" y1="20" x2="100" y2="180" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
        <line x1="100" y1="100" x2="240" y2="100" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
        <line x1="380" y1="100" x2="460" y2="100" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
        <line x1="380" y1="20" x2="380" y2="180" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
        <line x1="240" y1="100" x2="380" y2="100" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
        {/* Baselines */}
        <line x1="20" y1="20" x2="20" y2="180" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
        <line x1="460" y1="20" x2="460" y2="180" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />

        {/* Player A label (left side) */}
        <text x="100" y="14" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" opacity="0.85">
          {lastA}
        </text>
        {/* Player B label (right side) */}
        <text x="380" y="14" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" opacity="0.85">
          {lastB}
        </text>

        {/* Server ball — small circle on the side serving */}
        {server === 'A' && (
          <g>
            <circle cx="60" cy="100" r="6" fill="var(--color-accent)">
              <animate attributeName="r" values="6;8;6" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle cx="60" cy="100" r="3" fill="white" />
          </g>
        )}
        {server === 'B' && (
          <g>
            <circle cx="420" cy="100" r="6" fill="var(--color-accent)">
              <animate attributeName="r" values="6;8;6" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle cx="420" cy="100" r="3" fill="white" />
          </g>
        )}

        {/* Score bar in the bottom */}
        <text x="100" y="196" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="ui-monospace, monospace" fill="currentColor">
          {setA} · {gameA} · {ptDispA}
        </text>
        <text x="380" y="196" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="ui-monospace, monospace" fill="currentColor">
          {setB} · {gameB} · {ptDispB}
        </text>
        <text x="240" y="196" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">
          sets · games · points
        </text>
      </svg>
    </div>
  );
}
