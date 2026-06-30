import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { LiveWinProbChart } from '@/components/LiveWinProbChart';
import { MatchTracker } from '@/components/MatchTracker';
import { AlertTriangleIcon } from '@/components/icons';
import { supabase } from '@/lib/supabase';
import { type Locale } from '@/lib/i18n';

export const revalidate = 30;

interface LiveState {
  id: number;
  sr_match_id: number;
  tournament_slug: string | null;
  set_a: number; set_b: number;
  game_a: number; game_b: number;
  point_a: number; point_b: number;
  server: 'A' | 'B' | null;
  tiebreak: boolean;
  best_of: number;
  match_finished: boolean;
  player_a_id: number | null;
  player_b_id: number | null;
  name_a: string | null;
  name_b: string | null;
  aces_a: number | null; aces_b: number | null;
  df_a: number | null; df_b: number | null;
  bp_won_a: number | null; bp_won_b: number | null;
  serve_pts_won_a: number | null; serve_pts_won_b: number | null;
  first_serve_won_a: number | null; first_serve_won_b: number | null;
  match_win_prob_a: number | null;
  set_win_prob_a: number | null;
  point_importance: number | null;
  p_a_serve_prior: number | null;
  p_b_serve_prior: number | null;
  p_a_serve_live: number | null;
  p_b_serve_live: number | null;
  running: boolean;
  captured_at: string;
}

interface PlayerInfo {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  photo_url: string | null;
  atp_rank: number | null;
  elo_overall: number | null;
}

interface LiveOddRow { source: string; odd_a: number | null; odd_b: number | null; captured_at: string; }
interface LivePickRow { selection: string; model_prob: number; live_odd: number | null; edge_pct: number | null; grade: string | null; score_description: string | null; posted_at: string; result: string | null; set_a?: number; set_b?: number; }

async function fetchLiveOdds(matchId: number): Promise<LiveOddRow | null> {
  const { data } = await supabase
    .from('live_odds_history')
    .select('source, odd_a, odd_b, captured_at')
    .eq('sr_match_id', matchId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as LiveOddRow | null;
}

async function fetchLivePicks(matchId: number): Promise<LivePickRow[]> {
  // Só EV positivo — pseudo-picks com EV neg são decisões do modelo que
  // o mercado já antecipou; não são recomendações de aposta.
  const { data } = await supabase
    .from('live_picks')
    .select('selection, model_prob, live_odd, edge_pct, grade, score_description, posted_at, result, set_a, set_b')
    .eq('sr_match_id', matchId)
    .gt('edge_pct', 0)
    .order('edge_pct', { ascending: false })
    .limit(30);
  return (data ?? []) as LivePickRow[];
}

async function fetchLatest(matchId: number): Promise<LiveState | null> {
  const { data } = await supabase
    .from('live_state')
    .select('*')
    .eq('sr_match_id', matchId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as LiveState | null;
}

async function fetchPlayers(ids: number[]): Promise<Record<number, PlayerInfo>> {
  if (ids.length === 0) return {};
  const { data } = await supabase
    .from('players')
    .select('id, slug, name, flag, photo_url, atp_rank, elo_overall')
    .in('id', ids);
  const out: Record<number, PlayerInfo> = {};
  for (const p of (data ?? []) as PlayerInfo[]) out[p.id] = p;
  return out;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  const id = Number(matchId);
  if (!Number.isFinite(id)) return { title: 'Jogo não encontrado' };
  const s = await fetchLatest(id);
  if (!s) return { title: 'Jogo · ao vivo' };
  const title = `${s.name_a ?? 'Player A'} vs ${s.name_b ?? 'Player B'} · Ao vivo`;
  return {
    title,
    description: `Probabilidade ao vivo, score, stats e tracker oficial. ${s.set_a}-${s.set_b} sets, ${s.game_a}-${s.game_b} no set atual.`,
    robots: { index: false, follow: true },
  };
}

const SURFACE_CLASS: Record<string, string> = {
  hard: 'surface-hard',
  clay: 'surface-clay',
  grass: 'surface-grass',
  indoor: 'surface-hard',
};

function pct(x: number | null | undefined): string {
  if (x == null) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function ServeStatRow({ label, a, b, fmt }: { label: string; a: number | null; b: number | null; fmt?: (x: number | null) => string }) {
  const f = fmt ?? ((x) => x == null ? '—' : String(x));
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)]/40 py-2 last:border-b-0">
      <span className="text-sm font-mono text-right w-16">{f(a)}</span>
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-mono text-left w-16">{f(b)}</span>
    </div>
  );
}

function ProbBar({ probA, nameA, nameB }: { probA: number; nameA: string; nameB: string }) {
  const a = Math.round(probA * 100);
  const b = 100 - a;
  return (
    <div>
      <div className="flex justify-between mb-1 text-xs text-gray-400">
        <span className="font-semibold text-[var(--color-accent)]">{nameA}</span>
        <span className="font-semibold">{nameB}</span>
      </div>
      <div className="relative h-7 bg-[var(--color-surface)] rounded overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-[var(--color-accent)] flex items-center justify-center text-xs font-bold text-[var(--color-surface)]"
          style={{ width: `${a}%` }}
        >
          {a}%
        </div>
        <div className="absolute inset-y-0 right-0 flex items-center justify-end pr-2 text-xs font-bold">
          {b}%
        </div>
      </div>
    </div>
  );
}

export default async function LiveMatchPage({
  params,
  locale = 'pt-PT',
}: {
  params: Promise<{ matchId: string }>;
  locale?: Locale;
}) {
  const { matchId } = await params;
  const id = Number(matchId);
  if (!Number.isFinite(id)) notFound();

  const state = await fetchLatest(id);
  if (!state) {
    return (
      <>
        <Header locale={locale} />
        <main id="main" className="flex-1">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-14">
            <h1 className="text-2xl md:text-3xl font-bold mb-3">Sem dados deste jogo</h1>
            <p className="text-gray-400 text-sm mb-6">
              Match ID {id} ainda não foi capturado pelo cron live. Aguarda 1-2 minutos ou volta ao{' '}
              <Link href="/ao-vivo" className="text-[var(--color-accent)] hover:underline">listing ao vivo</Link>.
            </p>
          </div>
        </main>
        <Footer locale={locale} />
      </>
    );
  }

  const playerIds = [state.player_a_id, state.player_b_id].filter((x): x is number => x != null);
  const [players, liveOdds, livePicks] = await Promise.all([
    fetchPlayers(playerIds),
    fetchLiveOdds(id),
    fetchLivePicks(id),
  ]);
  const pA = state.player_a_id ? players[state.player_a_id] : null;
  const pB = state.player_b_id ? players[state.player_b_id] : null;
  const nameA = pA?.name ?? state.name_a ?? 'Player A';
  const nameB = pB?.name ?? state.name_b ?? 'Player B';

  const matchProb = state.match_win_prob_a;
  const imp = state.point_importance;
  const impHigh = imp != null && imp > 0.20;

  const scoreSets = `${state.set_a}-${state.set_b}`;
  const scoreCur = state.tiebreak ? 'Tiebreak' : `${state.game_a}-${state.game_b}`;

  // age da snapshot em segundos
  const ageSec = Math.round((Date.now() - new Date(state.captured_at).getTime()) / 1000);
  const fresh = ageSec < 90;

  return (
    <>
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">

          {/* HEADER */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {state.running && (
                <span className="inline-flex items-center gap-1.5 bg-red-500/15 border border-red-500/40 text-red-400 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  AO VIVO
                </span>
              )}
              {state.match_finished && (
                <span className="text-xs bg-[var(--color-card)] border border-[var(--color-border)] rounded-full px-2.5 py-0.5 text-gray-400">
                  Terminado
                </span>
              )}
              {state.tournament_slug && (
                <Link
                  href={`/torneios/${state.tournament_slug}`}
                  className="text-xs text-gray-400 hover:text-[var(--color-accent)] transition"
                >
                  {state.tournament_slug.replace(/-/g, ' ')}
                </Link>
              )}
              <span className="text-xs text-gray-500 ml-auto">
                {fresh ? `atualizado há ${ageSec}s` : `desactualizado · ${ageSec}s`}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold">
              {nameA} <span className="text-gray-500 font-normal">vs</span> {nameB}
            </h1>
          </div>

          {/* SCORE BOARD */}
          <div className="stat-card p-4 md:p-6">
            <div className="grid grid-cols-3 items-center gap-4">
              <div className="text-right">
                <div className="text-base md:text-lg font-bold truncate">{nameA}</div>
                {pA?.atp_rank && <div className="text-xs text-gray-500">#{pA.atp_rank} · ELO {pA.elo_overall ?? '–'}</div>}
              </div>
              <div className="text-center font-mono">
                <div className="text-3xl md:text-4xl font-extrabold tracking-wider">{scoreSets}</div>
                <div className="text-xs text-gray-500 mt-1">{scoreCur} {state.server && <span className="text-[var(--color-accent)]">· {state.server} serve</span>}</div>
              </div>
              <div className="text-left">
                <div className="text-base md:text-lg font-bold truncate">{nameB}</div>
                {pB?.atp_rank && <div className="text-xs text-gray-500">#{pB.atp_rank} · ELO {pB.elo_overall ?? '–'}</div>}
              </div>
            </div>
          </div>

          {/* OUR MODEL PROB */}
          {matchProb != null && (
            <div className="stat-card p-4 md:p-6">
              <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                <h2 className="text-sm uppercase tracking-wider text-gray-400">Modelo ELO · prob. vencer match</h2>
                {impHigh && (
                  <span className="text-xs bg-yellow-500/15 border border-yellow-500/40 text-yellow-400 rounded-full px-2.5 py-0.5 inline-flex items-center gap-1">
                    <AlertTriangleIcon size={12} /> Volatilidade elevada (I={imp!.toFixed(2)})
                  </span>
                )}
              </div>
              <ProbBar probA={matchProb} nameA={nameA} nameB={nameB} />
            </div>
          )}

          {/* LIVE ODDS + PICKS */}
          {liveOdds && (
            <div className="grid md:grid-cols-2 gap-4">
              {liveOdds && (
                <div className="stat-card p-4 md:p-5">
                  <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
                    Odds + EV ao vivo · {liveOdds.source}
                  </h2>
                  {(() => {
                    const evA = matchProb != null && liveOdds.odd_a != null ? (matchProb * liveOdds.odd_a - 1) * 100 : null;
                    const evB = matchProb != null && liveOdds.odd_b != null ? ((1 - matchProb) * liveOdds.odd_b - 1) * 100 : null;
                    const sideClass = (ev: number | null) => ev == null ? 'text-gray-500' : ev > 0 ? 'text-[var(--color-accent)]' : 'text-red-400';
                    return (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg bg-[var(--color-surface)] p-3">
                          <div className="text-xs text-gray-500 truncate">{nameA.split(',')[0]}</div>
                          <div className="text-2xl font-extrabold font-mono mt-1">
                            {liveOdds.odd_a != null ? liveOdds.odd_a.toFixed(2) : '—'}
                          </div>
                          <div className={`text-xs font-bold mt-1 font-mono ${sideClass(evA)}`}>
                            {evA != null ? `${evA > 0 ? '+' : ''}${evA.toFixed(1)}% EV` : '—'}
                          </div>
                        </div>
                        <div className="rounded-lg bg-[var(--color-surface)] p-3">
                          <div className="text-xs text-gray-500 truncate">{nameB.split(',')[0]}</div>
                          <div className="text-2xl font-extrabold font-mono mt-1">
                            {liveOdds.odd_b != null ? liveOdds.odd_b.toFixed(2) : '—'}
                          </div>
                          <div className={`text-xs font-bold mt-1 font-mono ${sideClass(evB)}`}>
                            {evB != null ? `${evB > 0 ? '+' : ''}${evB.toFixed(1)}% EV` : '—'}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <p className="text-[10px] text-gray-500 mt-3">
                    Captado há {Math.round((Date.now() - new Date(liveOdds.captured_at).getTime()) / 1000)}s · EV = modelo prob × odd − 1
                  </p>
                </div>
              )}

              <div className="stat-card p-4 md:p-5">
                <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
                  Picks recomendados (EV+)
                </h2>
                {(() => {
                  // Agrupa picks por set (set_a + set_b + 1 = nº do set onde foi emitida)
                  // Mantém 1 pick por set (a de maior edge). Mais recente fica em destaque.
                  type PickWithSet = LivePickRow & { setNum: number };
                  const enriched: PickWithSet[] = livePicks.map(p => {
                    const sa = (p as LivePickRow & { set_a?: number }).set_a ?? 0;
                    const sb = (p as LivePickRow & { set_b?: number }).set_b ?? 0;
                    return { ...p, setNum: sa + sb + 1 };
                  });
                  const bestPerSet = new Map<number, PickWithSet>();
                  for (const p of enriched) {
                    const existing = bestPerSet.get(p.setNum);
                    if (!existing || (p.edge_pct ?? 0) > (existing.edge_pct ?? 0)) {
                      bestPerSet.set(p.setNum, p);
                    }
                  }
                  const grouped = [...bestPerSet.values()].sort((a, b) => b.setNum - a.setNum);
                  if (grouped.length === 0) {
                    return (
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Nenhuma recomendação neste momento — o mercado está alinhado ou
                        mais confiante que o modelo. Vê o EV ao vivo à esquerda para
                        as posições actuais.
                      </p>
                    );
                  }
                  const current = grouped[0];
                  const history = grouped.slice(1);
                  const renderPick = (p: PickWithSet, big: boolean) => {
                    const sideName = p.selection === 'A' ? nameA.split(',')[0] : nameB.split(',')[0];
                    return (
                      <div className="flex items-baseline gap-3">
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold truncate ${big ? 'text-base md:text-lg' : 'text-xs'}`}>
                            {sideName}
                          </div>
                          {big && (
                            <div className="text-[10px] text-gray-500 mt-0.5">prob {Math.round(p.model_prob * 100)}%</div>
                          )}
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <div className={`font-mono ${big ? 'text-base md:text-lg' : 'text-xs'}`}>
                            {p.live_odd != null ? `@${p.live_odd.toFixed(2)}` : '—'}
                          </div>
                          <div className={`font-bold text-[var(--color-accent)] ${big ? 'text-sm' : 'text-[10px]'}`}>
                            {p.edge_pct != null ? `+${p.edge_pct.toFixed(1)}% EV` : ''}
                          </div>
                        </div>
                        {p.grade && (
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)]`}>
                            {p.grade}
                          </span>
                        )}
                      </div>
                    );
                  };
                  return (
                    <div>
                      {/* CURRENT pick — destaque com Set N badge */}
                      <div className="rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 p-3 mb-3">
                        <div className="flex items-baseline justify-between mb-2">
                          <span className="text-[10px] uppercase tracking-wider text-[var(--color-accent)] font-bold">
                            Set {current.setNum} · actual
                          </span>
                        </div>
                        {renderPick(current, true)}
                      </div>

                      {/* HISTORY: 1 pick por set anterior */}
                      {history.length > 0 && (
                        <>
                          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
                            Histórico por set
                          </div>
                          <div className="space-y-2">
                            {history.map(p => (
                              <div key={p.posted_at} className="flex items-center gap-2 py-1.5 border-b border-[var(--color-border)]/40 last:border-b-0">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 w-12 flex-shrink-0">
                                  Set {p.setNum}
                                </span>
                                <div className="flex-1">
                                  {renderPick(p, false)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* P EVOLUTION CHART */}
          <LiveWinProbChart srMatchId={id} nameA={nameA} nameB={nameB} />

          {/* OUR MATCH TRACKER (substitui betradar widget que tem licença limitada) */}
          <MatchTracker
            matchId={id}
            nameA={nameA}
            nameB={nameB}
            initial={{
              set_a: state.set_a,
              set_b: state.set_b,
              game_a: state.game_a,
              game_b: state.game_b,
              point_a: state.point_a,
              point_b: state.point_b,
              server: state.server,
              tiebreak: state.tiebreak,
              aces_a: state.aces_a,
              aces_b: state.aces_b,
              df_a: state.df_a,
              df_b: state.df_b,
              match_finished: state.match_finished,
              final_winner: null,
            }}
          />

          {/* STATS */}
          <div className="stat-card p-4 md:p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">Stats live</h2>
            <ServeStatRow label="Aces" a={state.aces_a} b={state.aces_b} />
            <ServeStatRow label="Double Faults" a={state.df_a} b={state.df_b} />
            <ServeStatRow label="BPs ganhos" a={state.bp_won_a} b={state.bp_won_b} />
            <ServeStatRow label="Pts serviço ganhos" a={state.serve_pts_won_a} b={state.serve_pts_won_b} />
            <ServeStatRow label="1ª serviço won %" a={state.first_serve_won_a} b={state.first_serve_won_b} fmt={(x) => x == null ? '—' : `${x}%`} />
          </div>

        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
