/**
 * SurfaceFormGrid — substitui o scatter ELO Geral vs Surface na página
 * /torneios/[slug]/preparacao. Em vez de cruzar Geral × Surface (a maioria
 * dos jogadores fica abaixo da paridade, o que era pouco accionável),
 * mostra a trajectória recente do ELO de cada top contender na surface
 * do torneio:
 *
 *   [foto] Sinner    /‾\__/‾   +18 ↑
 *   [foto] Alcaraz   ‾\___/‾    +9 ↑
 *   [foto] Zverev    ‾\____    −22 ↓
 *
 * Ordenado por quem mais subiu — leitura instantânea de "quem chega quente".
 *
 * Fonte: tabela elo_history (snapshots mensais, últimos 6 meses).
 * Nota de escala: elo_history guarda ainda os ratings match-level legacy,
 * por isso os deltas estão nessa escala (não set-level/display). Para um
 * sparkline isto é irrelevante — só interessa a forma da curva.
 *
 * Server component, sem JS no cliente.
 */
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { surfaceLabel, type Locale } from '@/lib/i18n';

const SURF_COL = {
  hard: 'elo_hard',
  clay: 'elo_clay',
  grass: 'elo_grass',
} as const;

interface PlayerInput {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  photo_url: string | null;
  atp_rank: number | null;
}

interface HistoryRow {
  player_id: number;
  date: string;
  elo_hard: number | null;
  elo_clay: number | null;
  elo_grass: number | null;
}

// Sparkline geometry
const SW = 86;
const SH = 26;

export async function SurfaceFormGrid({
  tour,
  surface,
  players,
  locale,
  prefix,
}: {
  tour: 'atp' | 'wta';
  surface: 'hard' | 'clay' | 'grass';
  players: PlayerInput[];
  locale: Locale;
  prefix: string;
}) {
  if (players.length === 0) return null;
  const col = SURF_COL[surface];
  const surfLbl = surfaceLabel(locale, surface).toLowerCase();

  const top = players.slice(0, 16);
  const ids = top.map(p => p.id);

  // Últimos ~7 meses para apanhar pelo menos 6 snapshots
  const since = new Date();
  since.setMonth(since.getMonth() - 7);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('elo_history')
    .select(`player_id, date, ${col}`)
    .in('player_id', ids)
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error) {
    console.error('[SurfaceFormGrid]', error.message);
    return null;
  }

  const rows = (data ?? []) as unknown as HistoryRow[];

  // Agrupar por player_id (já vem ordenado por data ASC)
  const byPlayer = new Map<number, { date: string; value: number }[]>();
  for (const r of rows) {
    const v = (r as unknown as Record<string, number | null>)[col];
    if (v == null || v < 800 || v > 3000) continue;
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id)!.push({ date: r.date, value: v });
  }

  type Entry = {
    p: PlayerInput;
    points: { date: string; value: number }[];
    delta: number;
    last: number;
  };

  const entries: Entry[] = top
    .map(p => {
      const pts = byPlayer.get(p.id) ?? [];
      if (pts.length < 2) return null;
      const first = pts[0].value;
      const last = pts[pts.length - 1].value;
      return { p, points: pts, delta: last - first, last };
    })
    .filter((x): x is Entry => x !== null)
    .sort((a, b) => b.delta - a.delta);

  if (entries.length < 3) return null;

  // Escala Y global (todos os sparklines comparáveis entre si)
  let gMin = Infinity;
  let gMax = -Infinity;
  for (const e of entries) {
    for (const pt of e.points) {
      if (pt.value < gMin) gMin = pt.value;
      if (pt.value > gMax) gMax = pt.value;
    }
  }
  const span = Math.max(gMax - gMin, 40);
  gMin -= span * 0.1;
  gMax += span * 0.1;
  const yRange = gMax - gMin;

  const heatingUp = entries.filter(e => e.delta > 10).length;
  const coolingDown = entries.filter(e => e.delta < -10).length;

  return (
    <div className="stat-card p-4 md:p-5 mb-8">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-bold text-base md:text-lg flex items-center gap-2">
          <span>📊</span>
          <span>Forma em {surfLbl}</span>
        </h2>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">
          {tour.toUpperCase()} · últimos 6 meses
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4 max-w-3xl">
        Trajectória do ELO de cada top contender em {surfLbl} ao longo dos últimos
        6 meses. Ordenado por quem mais subiu —{' '}
        <span className="text-[var(--color-accent)] font-semibold">{heatingUp} a aquecer</span>,{' '}
        <span className="text-red-400 font-semibold">{coolingDown} a arrefecer</span>.
      </p>

      <ul className="space-y-1">
        {entries.map(({ p, points, delta, last }) => {
          const initials = p.name
            .split(' ')
            .map(n => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
          const path = points
            .map((pt, i) => {
              const x = (i / Math.max(1, points.length - 1)) * SW;
              const y = (1 - (pt.value - gMin) / yRange) * SH;
              return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(' ');
          const up = delta > 10;
          const down = delta < -10;
          const color = up
            ? 'var(--color-accent)'
            : down
              ? '#ff7a7a'
              : '#9aa3a6';
          const lastY = (1 - (last - gMin) / yRange) * SH;

          return (
            <li key={p.id}>
              <Link
                href={`${prefix}/jogador/${p.slug}`}
                className="grid grid-cols-[36px_minmax(0,1fr)_auto_auto] items-center gap-2.5 md:gap-3 -mx-1 px-1.5 py-1.5 rounded hover:bg-[var(--color-card)] transition"
              >
                <div className="relative w-9 h-9 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {p.photo_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={p.photo_url}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                      style={{ objectPosition: 'top center' }}
                    />
                  ) : (
                    <span className="text-[10px] font-bold text-gray-500">
                      {initials}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate flex items-center gap-1">
                    <span className="truncate">{p.name}</span>
                    {p.flag && (
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {p.flag}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono">
                    {p.atp_rank ? `#${p.atp_rank} oficial` : '—'}
                  </div>
                </div>
                <svg
                  width={SW}
                  height={SH}
                  viewBox={`0 0 ${SW} ${SH}`}
                  className="block shrink-0"
                  aria-hidden
                >
                  {/* linha baseline subtil */}
                  <line
                    x1={0}
                    x2={SW}
                    y1={SH / 2}
                    y2={SH / 2}
                    stroke="var(--color-border)"
                    strokeWidth="0.5"
                    strokeDasharray="1 3"
                    opacity="0.5"
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={SW} cy={lastY} r="2" fill={color} />
                </svg>
                <div
                  className={`text-right font-mono font-bold text-sm whitespace-nowrap min-w-[42px] ${
                    up
                      ? 'text-[var(--color-accent)]'
                      : down
                        ? 'text-red-400'
                        : 'text-gray-500'
                  }`}
                >
                  {delta > 0 ? '+' : ''}
                  {Math.round(delta)}
                  <span className="text-[10px] ml-0.5 opacity-70">
                    {up ? '↑' : down ? '↓' : '·'}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-gray-500 mt-3">
        Snapshots mensais. Mostra apenas jogadores com ≥2 pontos no período.
      </p>
    </div>
  );
}
