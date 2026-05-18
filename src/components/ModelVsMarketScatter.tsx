/**
 * ModelVsMarketScatter — scatter X=P(mercado), Y=P(modelo) para outrights
 * de torneios. Diagonal = consenso. Acima = value pick. Abaixo = overhyped.
 *
 * Mostrado em /torneios/[slug]/predictor quando há outright_odds populadas
 * para o torneio. Server component.
 *
 * Recebe um Map de player_id → {p, name, slug} já calculado pelo Monte
 * Carlo na página predictor — assim partilhamos o cómputo.
 */
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export interface ModelEntry {
  p: number;         // P(champion) segundo o modelo (0..1)
  name: string;
  slug: string;
}

interface OddsRow {
  player_id: number | null;
  raw_name: string;
  best_decimal: number;
  best_bookies: string | null;
  implied_prob: number;
  fetched_at: string;
}

interface Entry {
  name: string;
  slug: string;
  market: number;
  model: number;
  odd: number;
  ev: number;        // expected value % per €1
  bookies: string;
}

// Layout
const W = 720;
const H = 420;
const PAD_L = 56;
const PAD_R = 24;
const PAD_T = 24;
const PAD_B = 48;

export async function ModelVsMarketScatter({
  tournamentId,
  modelByPlayerId,
  prefix = '',
}: {
  tournamentId: number;
  modelByPlayerId: Map<number, ModelEntry>;
  prefix?: string;
}) {
  const { data, error } = await supabase
    .from('outright_odds')
    .select('player_id, raw_name, best_decimal, best_bookies, implied_prob, fetched_at')
    .eq('tournament_id', tournamentId)
    .not('player_id', 'is', null);

  if (error || !data || data.length === 0) return null;
  const rows = data as OddsRow[];

  const entries: Entry[] = [];
  for (const r of rows) {
    if (r.player_id == null) continue;
    const m = modelByPlayerId.get(r.player_id);
    if (!m || m.p <= 0) continue;
    const market = Number(r.implied_prob);
    const odd = Number(r.best_decimal);
    if (!isFinite(odd) || odd <= 1.01) continue;
    const ev = (m.p * odd - 1) * 100;
    entries.push({
      name: m.name,
      slug: m.slug,
      market,
      model: m.p,
      odd,
      ev,
      bookies: r.best_bookies ?? '',
    });
  }

  if (entries.length < 5) return null;

  // Escala — usa máx entre model/market, com cap a 100%
  const peak = Math.max(...entries.map(e => Math.max(e.market, e.model)));
  const maxProb = Math.min(1, Math.max(0.05, peak * 1.15));

  function x(p: number) {
    return PAD_L + (p / maxProb) * (W - PAD_L - PAD_R);
  }
  function y(p: number) {
    return PAD_T + (1 - p / maxProb) * (H - PAD_T - PAD_B);
  }

  // Top picks
  const valuePicks = [...entries].filter(e => e.ev > 5).sort((a, b) => b.ev - a.ev).slice(0, 6);
  const overhyped  = [...entries].filter(e => e.ev < -10).sort((a, b) => a.ev - b.ev).slice(0, 4);

  // Timestamp mais recente
  const fetchedAt = rows.reduce<string | null>((latest, r) => {
    return !latest || r.fetched_at > latest ? r.fetched_at : latest;
  }, null);
  let fetchedAgo = '';
  if (fetchedAt) {
    // Server component, executa uma vez por request — Date.now é seguro aqui.
    // eslint-disable-next-line react-hooks/purity
    const hours = (Date.now() - new Date(fetchedAt).getTime()) / (60 * 60 * 1000);
    fetchedAgo = hours < 1 ? '<1h' : hours < 24 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`;
  }

  // Gridlines — probabilidades-chave
  const ALL_GRID = [0.05, 0.1, 0.25, 0.5, 0.75, 1];
  const gridProbs = ALL_GRID.filter(p => p <= maxProb + 0.01);

  return (
    <div className="stat-card p-4 md:p-5 mb-6">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-bold text-base md:text-lg flex items-center gap-2">
          <span>💰</span>
          <span>Modelo vs Mercado</span>
        </h2>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">
          {entries.length} jogadores · odds {fetchedAgo} atrás
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4 max-w-3xl leading-snug">
        Cada bola = 1 jogador. Eixo X = probabilidade implícita pelo mercado (1/best&nbsp;odd).
        Eixo Y = P(campeão) segundo o modelo Monte Carlo.{' '}
        <span className="text-[var(--color-accent)] font-semibold">Acima da diagonal</span>{' '}
        = value (modelo &gt; mercado).{' '}
        <span style={{ color: '#ff7a7a' }} className="font-semibold">Abaixo</span>{' '}
        = overhyped pelo mercado.
      </p>

      <div className="overflow-x-auto -mx-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto min-w-[480px]"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Scatter Modelo vs Mercado para outrights"
        >
          {/* Gridlines + labels */}
          {gridProbs.map((p, i) => (
            <g key={`g${i}`}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(p)}
                y2={y(p)}
                stroke="var(--color-border)"
                strokeWidth="1"
                strokeDasharray={i === 0 ? '' : '2 4'}
                opacity={i === 0 ? 1 : 0.4}
              />
              <line
                y1={PAD_T}
                y2={H - PAD_B}
                x1={x(p)}
                x2={x(p)}
                stroke="var(--color-border)"
                strokeWidth="1"
                strokeDasharray={i === 0 ? '' : '2 4'}
                opacity={i === 0 ? 1 : 0.4}
              />
              <text
                x={PAD_L - 8}
                y={y(p) + 3}
                fontSize="10"
                fill="#9aa3a6"
                textAnchor="end"
                fontFamily="var(--font-mono)"
              >
                {(p * 100).toFixed(0)}%
              </text>
              <text
                x={x(p)}
                y={H - PAD_B + 16}
                fontSize="10"
                fill="#9aa3a6"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {(p * 100).toFixed(0)}%
              </text>
            </g>
          ))}

          {/* Axis titles */}
          <text
            x={PAD_L + (W - PAD_L - PAD_R) / 2}
            y={H - 6}
            fontSize="11"
            fill="#9aa3a6"
            textAnchor="middle"
            fontWeight="600"
          >
            P(mercado) →
          </text>
          <text
            x={-PAD_T - (H - PAD_T - PAD_B) / 2}
            y={14}
            fontSize="11"
            fill="#9aa3a6"
            textAnchor="middle"
            fontWeight="600"
            transform="rotate(-90)"
          >
            P(modelo) →
          </text>

          {/* Diagonal de consenso */}
          <line
            x1={x(0)}
            y1={y(0)}
            x2={x(maxProb)}
            y2={y(maxProb)}
            stroke="#9aa3a6"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            opacity="0.55"
          />
          <text
            x={x(maxProb) - 6}
            y={y(maxProb) + 14}
            fontSize="9"
            fill="#9aa3a6"
            textAnchor="end"
            opacity="0.8"
          >
            consenso
          </text>

          {/* Pontos */}
          {entries.map((e, i) => {
            const isValue = e.ev > 5;
            const isOver = e.ev < -10;
            const color = isValue
              ? 'var(--color-accent)'
              : isOver
                ? '#ff7a7a'
                : 'rgba(255,255,255,0.45)';
            // Raio: 3 base + escala com magnitude de |EV|
            const r = Math.max(3, Math.min(9, 3 + Math.sqrt(Math.abs(e.ev)) * 0.7));
            return (
              <circle
                key={i}
                cx={x(e.market)}
                cy={y(e.model)}
                r={r}
                fill={color}
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="0.5"
                opacity={isValue || isOver ? 0.92 : 0.6}
              >
                <title>
                  {e.name}: modelo {(e.model * 100).toFixed(1)}% · mercado {(e.market * 100).toFixed(1)}% · @ {e.odd.toFixed(2)} · EV {e.ev > 0 ? '+' : ''}
                  {e.ev.toFixed(0)}%
                </title>
              </circle>
            );
          })}
        </svg>
      </div>

      {/* Value picks / Overhyped */}
      {(valuePicks.length > 0 || overhyped.length > 0) && (
        <div className="mt-5 grid md:grid-cols-2 gap-4">
          {valuePicks.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-[var(--color-accent)] uppercase tracking-wider mb-2">
                💎 Value picks (+EV)
              </h3>
              <ul className="space-y-1.5">
                {valuePicks.map(e => (
                  <li key={e.slug}>
                    <Link
                      href={`${prefix}/jogador/${e.slug}`}
                      className="flex items-baseline justify-between text-sm gap-2 hover:text-[var(--color-accent)]"
                    >
                      <span className="truncate">{e.name}</span>
                      <span className="font-mono whitespace-nowrap text-xs">
                        @ <span className="text-[var(--color-accent)] font-bold">{e.odd.toFixed(2)}</span>
                        <span className="text-gray-500 ml-1.5">
                          EV +{e.ev.toFixed(0)}%
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {overhyped.length > 0 && (
            <div>
              <h3
                className="text-xs font-bold uppercase tracking-wider mb-2"
                style={{ color: '#ff7a7a' }}
              >
                ⚠️ Overhyped (-EV)
              </h3>
              <ul className="space-y-1.5">
                {overhyped.map(e => (
                  <li key={e.slug}>
                    <Link
                      href={`${prefix}/jogador/${e.slug}`}
                      className="flex items-baseline justify-between text-sm gap-2 hover:text-red-400"
                    >
                      <span className="truncate">{e.name}</span>
                      <span className="font-mono whitespace-nowrap text-xs">
                        @ <span style={{ color: '#ff7a7a' }} className="font-bold">{e.odd.toFixed(2)}</span>
                        <span className="text-gray-500 ml-1.5">
                          EV {e.ev.toFixed(0)}%
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-gray-500 mt-4">
        Best decimal odds (gross return) entre bookmakers. EV calculado contra a P(campeão)
        do nosso modelo Monte Carlo, sem de-vig. Fonte: mercado público de apostas.
      </p>
    </div>
  );
}
