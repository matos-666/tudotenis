/**
 * SurfaceFormGrid — substitui o scatter ELO Geral vs Surface na página
 * /torneios/[slug]/preparacao.
 *
 * Mostra a trajectória recente do ELO de cada top contender na surface
 * do torneio, num formato compacto de lista com sparkline:
 *
 *   [foto] Sinner    /‾\__/‾   +18 ↑
 *   [foto] Alcaraz   ‾\___/‾    +9 ↑
 *   [foto] Zverev    ‾\____    −22 ↓
 *
 * Ordenado por quem mais subiu — leitura instantânea de "quem chega quente".
 *
 * Fonte: tabela elo_history (snapshots da training run + cron semanal de
 * snapshot). Janela = 12 meses ou tudo o que houver, com o subtítulo a
 * mostrar o range real (não hardcoded).
 *
 * Mobile-first: sparkline 70px em qualquer ecrã, foto 32→36, ATP rank
 * só visível em ≥sm.
 *
 * Nota de escala: elo_history usa a escala match-level legacy. Para um
 * sparkline isto é irrelevante — só importa a forma da curva.
 *
 * Server component, sem JS no cliente.
 */
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { surfaceLabel, type Locale } from '@/lib/i18n';
import { ChartIcon } from '@/components/icons';

// Set-level (Phase C) é a fonte de verdade actual; legacy match-level só
// serve de fallback para snapshots antigos onde ainda não havia set-level.
const SURF_COL_SET = {
  hard: 'elo_set_hard',
  clay: 'elo_set_clay',
  grass: 'elo_set_grass',
} as const;
const SURF_COL_LEGACY = {
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
  elo_set_hard: number | null;
  elo_set_clay: number | null;
  elo_set_grass: number | null;
}

// Sparkline geometry (mobile-friendly width)
const SW = 70;
const SH = 24;

// Etiqueta abreviada de data ("Jun '25")
const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function fmtDate(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return `${MONTHS_PT[parseInt(m, 10) - 1] ?? m} ${y.slice(2)}`;
}

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
  const setCol = SURF_COL_SET[surface];
  const legacyCol = SURF_COL_LEGACY[surface];
  const surfLbl = surfaceLabel(locale, surface).toLowerCase();

  const top = players.slice(0, 16);
  const ids = top.map(p => p.id);

  // Janela: últimos 12 meses (capta movimentos de Roland Garros anterior, etc.)
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('elo_history')
    .select(`player_id, date, ${setCol}, ${legacyCol}`)
    .in('player_id', ids)
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error) {
    console.error('[SurfaceFormGrid]', error.message);
    return null;
  }

  const rows = (data ?? []) as unknown as HistoryRow[];

  // Para cada player, agrupar os pontos usando set-level se disponível,
  // senão legacy. NÃO mistura escalas — escolhe a melhor série disponível.
  const byPlayer = new Map<number, { date: string; value: number }[]>();
  const setBuckets = new Map<number, { date: string; value: number }[]>();
  const legacyBuckets = new Map<number, { date: string; value: number }[]>();
  for (const r of rows) {
    const setV = (r as unknown as Record<string, number | null>)[setCol];
    const legV = (r as unknown as Record<string, number | null>)[legacyCol];
    if (setV != null && setV > 800 && setV < 3000) {
      if (!setBuckets.has(r.player_id)) setBuckets.set(r.player_id, []);
      setBuckets.get(r.player_id)!.push({ date: r.date, value: Number(setV) });
    }
    if (legV != null && legV > 800 && legV < 3000) {
      if (!legacyBuckets.has(r.player_id)) legacyBuckets.set(r.player_id, []);
      legacyBuckets.get(r.player_id)!.push({ date: r.date, value: Number(legV) });
    }
  }
  // Prefere série set-level se tem ≥2 pontos; senão usa legacy.
  for (const id of ids) {
    const setPts = setBuckets.get(id);
    if (setPts && setPts.length >= 2) {
      byPlayer.set(id, setPts);
    } else {
      const legPts = legacyBuckets.get(id);
      if (legPts && legPts.length >= 2) byPlayer.set(id, legPts);
    }
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

  // Empty/sparse state — mostra mensagem útil em vez de desaparecer
  if (entries.length < 3) {
    return (
      <div className="stat-card p-4 md:p-5 mb-8">
        <h2 className="font-bold text-base md:text-lg flex items-center gap-2 mb-2">
          <ChartIcon size={18} className="text-[var(--color-accent)]" />
          <span>Forma em {surfLbl}</span>
        </h2>
        <p className="text-xs text-gray-500">
          Histórico de snapshots ELO ainda insuficiente para este lote de
          contenders nesta surface. Vai-se preenchendo automaticamente
          (snapshot semanal).
        </p>
      </div>
    );
  }

  // Range real cobrindo todos os dados — usado no subtítulo
  const allDates = entries.flatMap(e => e.points.map(p => p.date)).sort();
  const firstDate = allDates[0];
  const lastDate = allDates[allDates.length - 1];

  // Escala Y global para sparklines comparáveis
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
  const flat = entries.length - heatingUp - coolingDown;

  return (
    <div className="stat-card p-4 md:p-5 mb-8">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-bold text-base md:text-lg flex items-center gap-2">
          <ChartIcon size={18} className="text-[var(--color-accent)]" />
          <span>Forma em {surfLbl}</span>
        </h2>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono whitespace-nowrap">
          {tour.toUpperCase()} · {fmtDate(firstDate)} → {fmtDate(lastDate)}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4 max-w-3xl leading-snug">
        Trajectória do ELO em {surfLbl} dos top contenders. Ordenado por quem
        mais subiu —{' '}
        <span className="text-[var(--color-accent)] font-semibold">
          {heatingUp} a aquecer
        </span>
        ,{' '}
        <span className="text-red-400 font-semibold">
          {coolingDown} a arrefecer
        </span>
        {flat > 0 && (
          <span className="text-gray-500">, {flat} estáveis</span>
        )}
        .
      </p>

      <ul className="space-y-0.5">
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
                className="grid grid-cols-[32px_minmax(0,1fr)_auto_auto] md:grid-cols-[36px_minmax(0,1fr)_auto_auto] items-center gap-2 md:gap-3 -mx-1 px-1.5 py-1.5 rounded hover:bg-[var(--color-card)] transition"
              >
                <div className="relative w-8 h-8 md:w-9 md:h-9 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
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
                  <div className="font-semibold text-xs md:text-sm truncate flex items-center gap-1">
                    <span className="truncate">{p.name}</span>
                    {p.flag && (
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {p.flag}
                      </span>
                    )}
                  </div>
                  <div className="hidden sm:block text-[10px] text-gray-500 font-mono">
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
                  className={`text-right font-mono font-bold text-xs md:text-sm whitespace-nowrap min-w-[38px] md:min-w-[42px] ${
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

      <p className="text-[10px] text-gray-500 mt-3 leading-snug">
        Snapshots ELO mensais + snapshot semanal (variação em pontos ELO match-level).
        Só inclui jogadores com ≥2 snapshots na janela.
      </p>
    </div>
  );
}
