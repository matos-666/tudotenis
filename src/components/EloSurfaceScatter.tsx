/**
 * EloSurfaceScatter — gráfico SVG que cruza ELO Geral (eixo X) com
 * ELO da surface do torneio (eixo Y). Usado nas páginas /torneios/[slug].
 *
 * Leitura:
 *   - Linha diagonal y=x = paridade. Jogadores em cima jogam igual em
 *     qualquer surface.
 *   - Acima da linha → especialista nesta surface.
 *   - Abaixo da linha → pior nesta surface que no geral.
 *
 * Server component (sem JS no cliente).
 */
import { supabase } from '@/lib/supabase';
import { surfaceLabel, type Locale } from '@/lib/i18n';

const SURFACE_COL = {
  hard: 'elo_hard',
  clay: 'elo_clay',
  grass: 'elo_grass',
  indoor: 'elo_indoor',
} as const;

const SURFACE_ACCENT = {
  hard: '#7fa8ff',
  clay: '#ffa472',
  grass: '#a3e0a3',
  indoor: '#c4a8ff',
} as const;

interface Row {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  atp_rank: number | null;
  elo_overall: number | null;
  elo_surface: number | null;
}

// Layout
const W = 800;
const H = 480;
const PAD_L = 56;
const PAD_R = 24;
const PAD_T = 28;
const PAD_B = 48;

export async function EloSurfaceScatter({
  tour,
  surface,
  limit = 32,
  locale = 'pt-PT',
}: {
  tour: string;          // 'atp' | 'wta'
  surface: string;       // 'hard' | 'clay' | 'grass' | 'indoor'
  limit?: number;
  locale?: Locale;
}) {
  const surfKey = surface.toLowerCase() as keyof typeof SURFACE_COL;
  const surfCol = SURFACE_COL[surfKey];
  const tourLower = tour.toLowerCase();

  // Surface não suportada → não renderiza nada
  if (!surfCol || (tourLower !== 'atp' && tourLower !== 'wta')) return null;

  const accent = SURFACE_ACCENT[surfKey];
  const surfLabel = surfaceLabel(locale, surfKey);

  // Top N por ELO geral, com ELO da surface populado
  const { data, error } = await supabase
    .from('players')
    .select(`id, slug, name, flag, atp_rank, elo_overall, elo_surface:${surfCol}`)
    .eq('tour', tourLower)
    .eq('active', true)
    .not('elo_overall', 'is', null)
    .not(surfCol, 'is', null)
    .gt('elo_overall', 1500)
    .order('elo_overall', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[EloSurfaceScatter]', error.message);
    return null;
  }

  const players = (data ?? []) as Row[];
  // Filtra outliers: surface ELO ≈ 1500 default = pouca atividade
  const valid = players.filter(
    p => p.elo_overall != null && p.elo_surface != null && Math.abs(p.elo_surface - 1500) > 30
  );

  if (valid.length < 6) {
    return null; // não vale a pena renderizar
  }

  // Range
  let minElo = Infinity;
  let maxElo = -Infinity;
  for (const p of valid) {
    const x = p.elo_overall as number;
    const y = p.elo_surface as number;
    if (x < minElo) minElo = x;
    if (y < minElo) minElo = y;
    if (x > maxElo) maxElo = x;
    if (y > maxElo) maxElo = y;
  }
  // Padding 5% cada lado, arredondado a 25
  const span = Math.max(maxElo - minElo, 100);
  minElo = Math.floor((minElo - span * 0.05) / 25) * 25;
  maxElo = Math.ceil((maxElo + span * 0.05) / 25) * 25;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  function x(elo: number) {
    return PAD_L + ((elo - minElo) / (maxElo - minElo)) * innerW;
  }
  function y(elo: number) {
    return PAD_T + (1 - (elo - minElo) / (maxElo - minElo)) * innerH;
  }

  // Gridlines (5 linhas em cada eixo)
  const gridSteps = 5;
  const gridValues = Array.from({ length: gridSteps + 1 }, (_, i) =>
    Math.round(minElo + ((maxElo - minElo) * i) / gridSteps)
  );

  // Top 8 — vão ter label
  const topByOverall = [...valid]
    .sort((a, b) => (b.elo_overall ?? 0) - (a.elo_overall ?? 0))
    .slice(0, 8);
  const topIds = new Set(topByOverall.map(p => p.id));

  function lastName(name: string): string {
    const parts = name.split(/\s+/);
    return parts[parts.length - 1];
  }

  // Quantos especialistas (above diagonal by ≥30) e weak (below by ≥30)
  const specialists = valid.filter(p => (p.elo_surface ?? 0) - (p.elo_overall ?? 0) >= 30);
  const weak = valid.filter(p => (p.elo_overall ?? 0) - (p.elo_surface ?? 0) >= 30);

  return (
    <div className="stat-card p-5 md:p-6 mb-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <h2 className="font-bold text-base md:text-lg">
          Quem está mais preparado para {surfLabel.toLowerCase()}?
        </h2>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">
          {tourLower.toUpperCase()} · top {valid.length}
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Cada bola = 1 jogador. Eixo X: ELO Geral · Eixo Y: ELO {surfLabel}.
        Linha diagonal = paridade. <span className="text-[var(--color-accent)]">Acima</span> = especialista nesta surface;{' '}
        <span style={{ color: '#ff7a7a' }}>abaixo</span> = pior nesta surface que no geral.
      </p>

      {/* Quick stats */}
      <div className="flex gap-4 text-xs mb-4 flex-wrap">
        <div>
          <span className="text-gray-500">Especialistas: </span>
          <span className="font-mono font-semibold text-[var(--color-accent)]">{specialists.length}</span>
        </div>
        <div>
          <span className="text-gray-500">Vulneráveis: </span>
          <span className="font-mono font-semibold" style={{ color: '#ff7a7a' }}>{weak.length}</span>
        </div>
      </div>

      <div className="overflow-x-auto -mx-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto min-w-[640px]"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Scatter plot ELO geral vs ELO ${surfLabel}`}
        >
          {/* Gridlines */}
          {gridValues.map((v, i) => (
            <g key={`g${i}`}>
              {/* Horizontal */}
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--color-border)"
                strokeWidth="1"
                strokeDasharray={i === 0 || i === gridSteps ? '' : '2 4'}
                opacity={i === 0 || i === gridSteps ? 1 : 0.5}
              />
              {/* Vertical */}
              <line
                y1={PAD_T}
                y2={H - PAD_B}
                x1={x(v)}
                x2={x(v)}
                stroke="var(--color-border)"
                strokeWidth="1"
                strokeDasharray={i === 0 || i === gridSteps ? '' : '2 4'}
                opacity={i === 0 || i === gridSteps ? 1 : 0.5}
              />
              {/* Y-axis label */}
              <text
                x={PAD_L - 8}
                y={y(v) + 3}
                fontSize="10"
                fill="var(--color-text-muted, #9aa3a6)"
                textAnchor="end"
                fontFamily="var(--font-mono)"
              >
                {v}
              </text>
              {/* X-axis label */}
              <text
                x={x(v)}
                y={H - PAD_B + 16}
                fontSize="10"
                fill="var(--color-text-muted, #9aa3a6)"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {v}
              </text>
            </g>
          ))}

          {/* Axis titles */}
          <text
            x={PAD_L + innerW / 2}
            y={H - 6}
            fontSize="11"
            fill="var(--color-text-muted, #9aa3a6)"
            textAnchor="middle"
            fontWeight="600"
          >
            ELO Geral →
          </text>
          <text
            x={-PAD_T - innerH / 2}
            y={14}
            fontSize="11"
            fill="var(--color-text-muted, #9aa3a6)"
            textAnchor="middle"
            fontWeight="600"
            transform="rotate(-90)"
          >
            ELO {surfLabel} →
          </text>

          {/* Diagonal y=x (paridade) */}
          <line
            x1={x(minElo)}
            y1={y(minElo)}
            x2={x(maxElo)}
            y2={y(maxElo)}
            stroke={accent}
            strokeWidth="1.5"
            strokeDasharray="6 4"
            opacity="0.5"
          />
          <text
            x={x(maxElo) - 6}
            y={y(maxElo) + 14}
            fontSize="9"
            fill={accent}
            textAnchor="end"
            opacity="0.7"
          >
            paridade
          </text>

          {/* Points */}
          {valid.map(p => {
            const px = x(p.elo_overall as number);
            const py = y(p.elo_surface as number);
            const diff = (p.elo_surface as number) - (p.elo_overall as number);
            const isSpecialist = diff >= 30;
            const isWeak = diff <= -30;
            const color = isSpecialist
              ? 'var(--color-accent)'
              : isWeak
                ? '#ff7a7a'
                : 'rgba(255,255,255,0.45)';
            const r = topIds.has(p.id) ? 5.5 : 4;
            return (
              <g key={p.id}>
                <circle
                  cx={px}
                  cy={py}
                  r={r}
                  fill={color}
                  stroke="rgba(0,0,0,0.4)"
                  strokeWidth="0.5"
                  opacity={topIds.has(p.id) ? 0.95 : 0.75}
                >
                  <title>
                    {p.name} — Geral {Math.round(p.elo_overall as number)} · {surfLabel} {Math.round(p.elo_surface as number)}
                    {diff !== 0 ? ` (${diff > 0 ? '+' : ''}${Math.round(diff)})` : ''}
                  </title>
                </circle>
                {topIds.has(p.id) && (
                  <text
                    x={px + 8}
                    y={py + 3}
                    fontSize="10"
                    fill="white"
                    fontWeight="600"
                    style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.7)', strokeWidth: '2.5px', strokeLinejoin: 'round' }}
                  >
                    {lastName(p.name)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-[10px] text-gray-500 mt-3">
        Filtrado: top {limit} por ELO geral, com ELO {surfLabel} medido (≥30 pts de diferença
        vs default 1500).
      </p>
    </div>
  );
}
