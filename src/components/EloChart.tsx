/**
 * EloChart — gráfico SVG inline da evolução ELO nos últimos 24 meses.
 * Server component (sem JS no cliente).
 *
 * Recebe array de snapshots ordenados por data ascendente.
 */
import { supabase } from '@/lib/supabase';
import { surfaceLabel, type Locale } from '@/lib/i18n';

interface Snapshot {
  date: string;
  elo_overall: number | null;
  elo_hard: number | null;
  elo_clay: number | null;
  elo_grass: number | null;
  elo_indoor: number | null;
}

// Surfaces base — label é localizado em runtime via surfaceLabel().
const SURFACES = [
  { key: 'elo_overall', surf: '',       color: 'var(--color-accent)', strokeWidth: 2.5, dash: '' },
  { key: 'elo_hard',    surf: 'hard',   color: '#7fa8ff',             strokeWidth: 1.5, dash: '4 3' },
  { key: 'elo_clay',    surf: 'clay',   color: '#ffa472',             strokeWidth: 1.5, dash: '4 3' },
  { key: 'elo_grass',   surf: 'grass',  color: '#a3e0a3',             strokeWidth: 1.5, dash: '4 3' },
  { key: 'elo_indoor',  surf: 'indoor', color: '#c4a8ff',             strokeWidth: 1.5, dash: '4 3' },
] as const;

// Layout
const W = 800;
const H = 220;
const PAD_L = 50;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 32;

export async function EloChart({ playerId, locale = 'pt-PT' }: { playerId: number; locale?: Locale }) {
  const labelFor = (surf: string) => surf === '' ? 'Geral' : surfaceLabel(locale, surf);
  const { data, error } = await supabase
    .from('elo_history')
    .select('date, elo_overall, elo_hard, elo_clay, elo_grass, elo_indoor')
    .eq('player_id', playerId)
    .order('date', { ascending: true });

  if (error) {
    console.error('[EloChart]', error.message);
  }

  const snaps = (data ?? []) as Snapshot[];

  // ── Filter "active" surfaces ──────────────────────────────────────────
  // Esconde linhas sem atividade real:
  //  - elo_overall: sempre mostra
  //  - superfície: mostra apenas se min/max diferem em pelo menos 30 ELO
  //    OU se valor mais recente está claramente fora do default 1500
  const activeSurfaces = SURFACES.filter(surf => {
    if (surf.key === 'elo_overall') return true;
    let mn = Infinity, mx = -Infinity;
    let lastValid: number | null = null;
    for (const s of snaps) {
      const v = s[surf.key];
      if (v != null && v > 800 && v < 3000) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        lastValid = v;
      }
    }
    if (!isFinite(mn) || lastValid == null) return false;
    const movement = mx - mn;
    const distFromDefault = Math.abs(lastValid - 1500);
    // Mostra se houve movimento real ≥30, OU se afastou ≥80 do default
    return movement >= 30 || distFromDefault >= 80;
  });

  // ── Empty state ─────────────────────────────────────────────────────────
  if (snaps.length < 2) {
    return (
      <div className="stat-card p-5 md:p-6 mb-8">
        <h2 className="font-bold mb-4">Evolução ELO · 24 meses</h2>
        <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
          Sem histórico suficiente — precisa de pelo menos 2 snapshots.
        </div>
      </div>
    );
  }

  // ── Compute scales ──────────────────────────────────────────────────────
  // X: index 0..n-1
  // Y: min/max ELO across active surfaces only
  let minElo = Infinity;
  let maxElo = -Infinity;
  for (const s of snaps) {
    for (const surf of activeSurfaces) {
      const v = s[surf.key];
      if (v != null && v > 800 && v < 3000) {
        if (v < minElo) minElo = v;
        if (v > maxElo) maxElo = v;
      }
    }
  }
  if (!isFinite(minElo)) { minElo = 1400; maxElo = 1600; }
  // Padding em Y
  const span = Math.max(maxElo - minElo, 50);
  minElo = Math.floor((minElo - span * 0.08) / 10) * 10;
  maxElo = Math.ceil((maxElo + span * 0.08) / 10) * 10;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  function x(i: number) {
    return PAD_L + (i / Math.max(1, snaps.length - 1)) * innerW;
  }
  function y(elo: number) {
    return PAD_T + (1 - (elo - minElo) / (maxElo - minElo)) * innerH;
  }

  // Build paths per active surface
  const paths = activeSurfaces.map(surf => {
    const points: string[] = [];
    snaps.forEach((s, i) => {
      const v = s[surf.key];
      if (v != null && v > 800) {
        points.push(`${i === 0 || points.length === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
      }
    });
    return { ...surf, d: points.join(' ') };
  });

  // Gridlines (4 horizontal)
  const gridlines = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const elo = Math.round(minElo + (maxElo - minElo) * (1 - t));
    return { y: PAD_T + t * innerH, label: elo };
  });

  // X labels (start, middle, end)
  function fmtDate(d: string) {
    const [y, m] = d.split('-');
    const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${months[parseInt(m) - 1] ?? m} ${y.slice(2)}`;
  }
  const xTicks = [
    { i: 0, label: fmtDate(snaps[0].date) },
    { i: Math.floor(snaps.length / 2), label: fmtDate(snaps[Math.floor(snaps.length / 2)].date) },
    { i: snaps.length - 1, label: fmtDate(snaps[snaps.length - 1].date) },
  ];

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="stat-card p-5 md:p-6 mb-8">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-bold">Evolução ELO · {snaps.length} snapshots</h2>
        <div className="flex gap-3 text-xs flex-wrap">
          {activeSurfaces.map(s => (
            <span key={s.key} className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-0.5"
                style={{
                  backgroundColor: s.color,
                  borderTop: s.dash ? `1px dashed ${s.color}` : undefined,
                  background: s.dash ? 'transparent' : s.color,
                }}
              />
              <span className="text-gray-400">{labelFor(s.surf)}</span>
            </span>
          ))}
          {activeSurfaces.length < SURFACES.length && (
            <span className="text-[10px] text-gray-600 ml-2">
              · {SURFACES.length - activeSurfaces.length} {locale === 'pt-BR' ? 'piso(s)' : 'superfície(s)'} sem atividade omitida(s)
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto min-w-[500px]"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Gráfico de evolução ELO"
        >
          {/* Gridlines */}
          {gridlines.map((g, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={g.y}
                y2={g.y}
                stroke="var(--color-border)"
                strokeWidth="1"
                strokeDasharray={i === gridlines.length - 1 ? '' : '2 4'}
              />
              <text
                x={PAD_L - 8}
                y={g.y + 3}
                fontSize="10"
                fill="var(--color-text-muted, #9aa3a6)"
                textAnchor="end"
                fontFamily="var(--font-mono)"
              >
                {g.label}
              </text>
            </g>
          ))}

          {/* X-axis */}
          {xTicks.map((t, i) => (
            <text
              key={i}
              x={x(t.i)}
              y={H - 12}
              fontSize="10"
              fill="var(--color-text-muted, #9aa3a6)"
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {t.label}
            </text>
          ))}

          {/* Paths */}
          {paths.map(p => (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth={p.strokeWidth}
              strokeDasharray={p.dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
