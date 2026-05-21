/**
 * H2HSparklineCompare — sobreposição das trajectórias ELO de 2 jogadores
 * usado nas páginas /h2h/[matchup].
 *
 * Diferente do SurfaceFormGrid (lista de sparklines pequenos), este é
 * UM gráfico com 2 linhas no mesmo plano — leitura instantânea de:
 *   - Quem está em ascensão / queda
 *   - Se o gap está a fechar ou a abrir
 *   - Quem chega "mais quente" ao confronto
 *
 * Fonte: elo_history. Prefere set-level (Phase C, fresco daily via cron)
 * com fallback para legacy match-level se snapshot não tem set-level.
 *
 * Server component, sem JS no cliente.
 */
import Image from 'next/image';
import { supabase } from '@/lib/supabase';

interface PlayerLite {
  id: number;
  name: string;
  flag: string | null;
  photo_url: string | null;
}

interface HistoryRow {
  player_id: number;
  date: string;
  elo_overall: number | null;
  elo_set_overall: number | null;
}

// SVG layout
const W = 720;
const H = 200;
const PAD_L = 50;
const PAD_R = 18;
const PAD_T = 14;
const PAD_B = 28;

const COLOR_P1 = 'var(--color-accent)';
const COLOR_P2 = '#ff9f5c'; // laranja para contrastar com o accent verde-lima

// Etiqueta abreviada de data ("Mai '25")
const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function fmtDate(dateStr: string): string {
  const [y, m] = dateStr.split('-');
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
    delta > 5
      ? 'text-[var(--color-accent)]'
      : delta < -5
        ? 'text-red-400'
        : 'text-gray-400';
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <div className="relative w-9 h-9 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
        {p.photo_url ? (
          <Image
            src={p.photo_url}
            alt=""
            width={72}
            height={72}
            className="w-full h-full object-cover"
            style={{ objectPosition: 'top center' }}
            unoptimized
          />
        ) : (
          <span className="text-[10px] font-bold text-gray-500">{initials}</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs md:text-sm font-semibold truncate">
          <span
            className="inline-block w-3 h-1 rounded-full shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          <span className="truncate">{p.name}</span>
          {p.flag && <span className="text-[10px] text-gray-500 shrink-0">{p.flag}</span>}
        </div>
        <div className={`text-[10px] md:text-xs font-mono ${trendColor}`}>
          {Math.round(eloLast)} · {delta > 0 ? '+' : ''}
          {delta} em 12m
        </div>
      </div>
    </div>
  );
}

export async function H2HSparklineCompare({
  p1,
  p2,
}: {
  p1: PlayerLite;
  p2: PlayerLite;
}) {
  // Janela: últimos 12 meses
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('elo_history')
    .select('player_id, date, elo_overall, elo_set_overall')
    .in('player_id', [p1.id, p2.id])
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error) {
    console.error('[H2HSparklineCompare]', error.message);
    return null;
  }

  const rows = (data ?? []) as HistoryRow[];

  // Para cada jogador, prefere set-level (≥2 pontos), fallback legacy
  function buildSeries(pid: number): { date: string; value: number }[] {
    const setPts: { date: string; value: number }[] = [];
    const legPts: { date: string; value: number }[] = [];
    for (const r of rows) {
      if (r.player_id !== pid) continue;
      const setV = r.elo_set_overall;
      const legV = r.elo_overall;
      if (setV != null && setV > 800 && setV < 3000) {
        setPts.push({ date: r.date, value: Number(setV) });
      }
      if (legV != null && legV > 800 && legV < 3000) {
        legPts.push({ date: r.date, value: Number(legV) });
      }
    }
    return setPts.length >= 2 ? setPts : legPts;
  }

  const s1 = buildSeries(p1.id);
  const s2 = buildSeries(p2.id);

  // Se algum jogador não tem dados suficientes, não renderiza
  if (s1.length < 2 || s2.length < 2) return null;

  // Escala Y comum aos dois jogadores
  let gMin = Infinity;
  let gMax = -Infinity;
  for (const pt of [...s1, ...s2]) {
    if (pt.value < gMin) gMin = pt.value;
    if (pt.value > gMax) gMax = pt.value;
  }
  const span = Math.max(gMax - gMin, 60);
  gMin -= span * 0.08;
  gMax += span * 0.08;
  const yRange = gMax - gMin;

  // Domínio X comum: data mínima da união
  const allDates = [...s1, ...s2].map(p => p.date).sort();
  const firstDate = allDates[0];
  const lastDate = allDates[allDates.length - 1];
  const firstTs = new Date(firstDate).getTime();
  const lastTs = new Date(lastDate).getTime();
  const xRange = Math.max(1, lastTs - firstTs);

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  function xPos(dateStr: string): number {
    const t = new Date(dateStr).getTime();
    return PAD_L + ((t - firstTs) / xRange) * innerW;
  }
  function yPos(value: number): number {
    return PAD_T + (1 - (value - gMin) / yRange) * innerH;
  }

  function pathFor(pts: { date: string; value: number }[]): string {
    return pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(p.date).toFixed(1)} ${yPos(p.value).toFixed(1)}`)
      .join(' ');
  }

  // Deltas (first vs last value de cada série)
  const d1 = Math.round(s1[s1.length - 1].value - s1[0].value);
  const d2 = Math.round(s2[s2.length - 1].value - s2[0].value);

  // Gridlines: 4 linhas Y, 2 ticks X (início + fim)
  const gridY = [0, 0.33, 0.67, 1].map(t => ({
    y: PAD_T + t * innerH,
    label: Math.round(gMax - t * yRange),
  }));

  return (
    <div className="stat-card p-4 md:p-5 mb-6">
      <h2 className="font-bold text-base md:text-lg flex items-center gap-2 mb-1">
        <span aria-hidden>📈</span>
        <span>Trajectória ELO · últimos 12 meses</span>
      </h2>
      <p className="text-xs text-gray-500 mb-4 max-w-3xl leading-snug">
        Evolução do ELO geral de cada jogador no último ano. Linhas próximas
        = match equilibrado; gap a aumentar = um deles em fase melhor.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <PlayerLegend p={p1} color={COLOR_P1} delta={d1} eloLast={s1[s1.length - 1].value} />
        <PlayerLegend p={p2} color={COLOR_P2} delta={d2} eloLast={s2[s2.length - 1].value} />
      </div>

      <div className="overflow-x-auto -mx-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto min-w-[480px]"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Trajectória ELO ${p1.name} vs ${p2.name}`}
        >
          {/* Gridlines Y */}
          {gridY.map((g, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={g.y}
                y2={g.y}
                stroke="var(--color-border)"
                strokeWidth="1"
                strokeDasharray={i === gridY.length - 1 ? '' : '2 4'}
                opacity={i === gridY.length - 1 ? 1 : 0.4}
              />
              <text
                x={PAD_L - 6}
                y={g.y + 3}
                fontSize="10"
                fill="#9aa3a6"
                textAnchor="end"
                fontFamily="var(--font-mono)"
              >
                {g.label}
              </text>
            </g>
          ))}

          {/* X-axis labels (start + end) */}
          <text
            x={PAD_L}
            y={H - 10}
            fontSize="10"
            fill="#9aa3a6"
            textAnchor="start"
          >
            {fmtDate(firstDate)}
          </text>
          <text
            x={W - PAD_R}
            y={H - 10}
            fontSize="10"
            fill="#9aa3a6"
            textAnchor="end"
          >
            {fmtDate(lastDate)}
          </text>

          {/* Player 1 line */}
          <path
            d={pathFor(s1)}
            fill="none"
            stroke={COLOR_P1}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* dot final */}
          <circle
            cx={xPos(s1[s1.length - 1].date)}
            cy={yPos(s1[s1.length - 1].value)}
            r="3"
            fill={COLOR_P1}
            stroke="var(--color-surface)"
            strokeWidth="1.5"
          />

          {/* Player 2 line */}
          <path
            d={pathFor(s2)}
            fill="none"
            stroke={COLOR_P2}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={xPos(s2[s2.length - 1].date)}
            cy={yPos(s2[s2.length - 1].value)}
            r="3"
            fill={COLOR_P2}
            stroke="var(--color-surface)"
            strokeWidth="1.5"
          />
        </svg>
      </div>

      <p className="text-[10px] text-gray-500 mt-2 leading-snug">
        Snapshots mensais set-level (fallback match-level se ainda em backfill).
        Eixo Y partilhado para os 2 jogadores.
      </p>
    </div>
  );
}
