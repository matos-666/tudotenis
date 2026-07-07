/**
 * Núcleo do poll live: Sportradar → modelo → live_state + picks.
 *
 * Extraído do endpoint Vercel para poder correr TAMBÉM no runner do
 * GitHub Actions (via tsx scripts/poll-live.ts), escrevendo direto no
 * Supabase — zero Vercel functions. Isto era o único caminho para
 * caber no free tier (4h Fluid Active CPU/mês): o polling contínuo em
 * Vercel functions consumia ~60h/mês.
 *
 * O endpoint /api/cron/live-state importa pollOnce daqui e mantém-se
 * como fallback / trigger manual. Uma só fonte de verdade da lógica.
 */
import { getServiceSupabase } from '@/lib/supabase';

const supabase = getServiceSupabase();
import {
  priorsFromElo,
  bayesianServeUpdate,
  matchWinProb,
  pointImportance,
  type MatchState,
  type Server,
} from '@/lib/live-markov';
import { resolveSrPlayers } from '@/lib/sr-player-match';

// Hardcoded Wimbledon 2026 season IDs descobertos via gismo
// stats_season_fixtures2. ATP = 132572. WTA TBD (adicionar quando
// descobrirmos via SR).
const ACTIVE_SEASONS = [
  { id: 132572, tour: 'atp' as const, tournamentSlug: 'wimbledon-2026-atp', isDoubles: false },
  { id: 132536, tour: 'wta' as const, tournamentSlug: 'wimbledon-2026-wta', isDoubles: false },
  // Duplas — season IDs descobertos via SR match_get (utid 2557/2561/2563).
  // SR trata cada dupla como um "team" único ('Kokkinakis T / Kovacevic A'),
  // por isso o fluxo de score/tracker funciona igual; só o prior do modelo
  // muda (team ELO doubles = média do par, resolvido por apelido+inicial).
  // Mistas usam curva 'atp' como aproximação de pace de serviço.
  { id: 136808, tour: 'atp' as const, tournamentSlug: 'wimbledon-2026-duplas-atp', isDoubles: true },
  { id: 136814, tour: 'wta' as const, tournamentSlug: 'wimbledon-2026-duplas-wta', isDoubles: true },
  { id: 136820, tour: 'atp' as const, tournamentSlug: 'wimbledon-2026-duplas-mistas', isDoubles: true },
];

const SR_BASE = 'https://lmt.fn.sportradar.com/betradar/en/Etc:UTC/gismo';
const SR_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const SR_REFERER = 'https://widgets.sir.sportradar.com/betradar/en/live-match-tracker';
const SR_ORIGIN = 'https://widgets.sir.sportradar.com';

async function sr<T = unknown>(path: string, timeoutMs = 3500): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SR_BASE}/${path}`, {
      headers: {
        'User-Agent': SR_UA,
        'Referer': SR_REFERER,
        'Origin': SR_ORIGIN,
        'Accept': 'application/json',
      },
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface SrSeasonMatch {
  _id: number;
  _utid: number;
  // stats_season_fixtures2 usa `time` (não `_dt` como em match_get)
  time?: { uts: number; date: string; time: string };
  teams: { home: { _id: number; name: string }; away: { _id: number; name: string } };
  round?: number;
}
interface SrMatchGet {
  _id: number;
  _sid: number;
  _seasonid: number;
  _utid: number;
  result?: { home: number; away: number; winner?: string };
  periods?: Record<string, { home: number; away: number }>;
  timeinfo?: { running?: boolean; ended?: string | null; started?: string };
  ended_uts?: number | false;
  p?: string;
  teams: {
    home: { _id: number; name: string };
    away: { _id: number; name: string };
  };
  // current game/tiebreak state
  gameId?: string;
  tiebreak?: boolean;
}
interface SrDetailsExtended {
  // Sportradar mistura tipos: alguns stats são numéricos directos ({home: 6}),
  // outros são strings tipo "4/9" (BPs) ou "64/20/84" (serve points won/lost/total).
  values: Record<string, { name: string; value: { home: number | string; away: number | string } }>;
}

function parseStatVal(v: number | string | undefined | null): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // String: pode ser "X" (numeric string), "X/Y" (fraction), "X/Y/Z" (triple)
  const parts = v.split('/').map(s => parseInt(s.trim(), 10));
  if (parts.length === 0 || !Number.isFinite(parts[0])) return null;
  return parts[0]; // numerator / primeiro componente
}

function parseStatDenom(v: number | string | undefined | null, kind: 'fraction' | 'triple'): number | null {
  if (typeof v !== 'string') return null;
  const parts = v.split('/').map(s => parseInt(s.trim(), 10));
  if (kind === 'fraction' && parts.length >= 2 && Number.isFinite(parts[1])) return parts[1];
  if (kind === 'triple' && parts.length >= 3 && Number.isFinite(parts[2])) return parts[2];
  return null;
}

function pickStat(d: SrDetailsExtended | null, key: string): { a: number | null; b: number | null } {
  const v = d?.values?.[key]?.value;
  return { a: parseStatVal(v?.home), b: parseStatVal(v?.away) };
}

function pickStatDenom(d: SrDetailsExtended | null, key: string, kind: 'fraction' | 'triple'): { a: number | null; b: number | null } {
  const v = d?.values?.[key]?.value;
  return { a: parseStatDenom(v?.home, kind), b: parseStatDenom(v?.away, kind) };
}

function buildState(m: SrMatchGet): MatchState | null {
  const periods = m.periods ?? {};
  const setKeys = Object.keys(periods).sort();
  let sA = 0, sB = 0;
  let currentSetIdx = 0;
  for (let i = 0; i < setKeys.length; i++) {
    const k = setKeys[i];
    const p = periods[k];
    if (p.home >= 6 && p.home - p.away >= 2) sA++;
    else if (p.away >= 6 && p.away - p.home >= 2) sB++;
    else if (p.home === 7 && p.away === 5) sA++;
    else if (p.away === 7 && p.home === 5) sB++;
    else if (p.home === 7 && p.away === 6) sA++;
    else if (p.away === 7 && p.home === 6) sB++;
    else { currentSetIdx = i; break; }
    currentSetIdx = i + 1;
  }
  const curSetKey = setKeys[currentSetIdx];
  const cur = curSetKey ? periods[curSetKey] : { home: 0, away: 0 };

  // Sportradar não publica point-level na season fixtures; vamos
  // inferir do timeline-delta separately. Por agora point=0-0 a
  // cada snapshot (refinado em iteração seguinte com timeline).
  const tiebreak = cur.home === 6 && cur.away === 6;

  return {
    ptA: 0,
    ptB: 0,
    gA: tiebreak ? 6 : cur.home,
    gB: tiebreak ? 6 : cur.away,
    sA, sB,
    server: 'A', // refined later via timeline
    bestOf: m._sid === 5 ? 5 : 3, // tennis = sid 5; grand slam men = BO5 (detected later via tour)
    tiebreak,
    finalSetSuperTiebreak: true, // Wimbledon since 2022
  };
}

/**
 * Resolve o team ELO doubles de um nome de equipa SR
 * ('Kokkinakis T / Kovacevic A') → média do elo_doubles_grass (fallback
 * overall) dos dois membros. Matching por apelido + inicial contra a
 * tabela players. Mistas passam tour=null (sem filtro de tour).
 * Devolve null se qualquer membro não resolver ou não tiver ELO doubles.
 */
async function resolveDoublesTeamElo(teamName: string, tour: 'atp' | 'wta' | null): Promise<number | null> {
  const members = teamName.split('/').map(s => s.trim()).filter(Boolean);
  if (members.length !== 2) return null;

  const elos: number[] = [];
  for (const member of members) {
    // 'Mpetshi Perricard G' → apelido='Mpetshi Perricard', inicial='G'.
    // Último token de 1-2 chars (com ou sem ponto) é inicial.
    const tokens = member.replace(/\./g, '').split(/\s+/).filter(Boolean);
    let initial = '';
    let surnameTokens = tokens;
    if (tokens.length > 1 && tokens[tokens.length - 1].length <= 2) {
      initial = tokens[tokens.length - 1].toLowerCase();
      surnameTokens = tokens.slice(0, -1);
    }
    const surname = surnameTokens.join(' ');
    if (!surname) return null;

    const { data } = await supabase
      .from('players')
      .select('id, name, tour, elo_doubles_grass, elo_doubles_overall')
      .ilike('name', `%${surname}%`)
      .limit(10);
    const cands = ((data ?? []) as Array<{ name: string; tour: string | null; elo_doubles_grass: number | null; elo_doubles_overall: number | null }>)
      .filter(p => tour == null || p.tour === tour)
      .filter(p => {
        // Filtro de inicial SÓ quando o nome na DB tem primeiro nome.
        // Especialistas de duplas importados só com apelido ('Cash',
        // 'Schuurs', 'Kumasaka') passavam a falhar startsWith(inicial)
        // e o team ELO nunca resolvia (prob=null em todas as duplas).
        const dbName = p.name.trim().toLowerCase();
        const dbTokens = dbName.split(/\s+/);
        if (initial === '' || dbTokens.length === 1) return true;
        return dbName.startsWith(initial);
      })
      .filter(p => p.elo_doubles_grass != null || p.elo_doubles_overall != null)
      // Prioriza match com primeiro nome (nome completo) sobre só-apelido
      .sort((a, b) => b.name.trim().split(/\s+/).length - a.name.trim().split(/\s+/).length);
    if (cands.length === 0) return null;
    const pick = cands[0];
    elos.push((pick.elo_doubles_grass ?? pick.elo_doubles_overall) as number);
  }
  return (elos[0] + elos[1]) / 2;
}

async function fetchPlayerEloTour(playerId: number): Promise<{
  elo: number | null; tour: 'atp' | 'wta' | null;
} | null> {
  const { data } = await supabase
    .from('players')
    .select('elo_set_grass, elo_overall, tour')
    .eq('id', playerId)
    .single();
  if (!data) return null;
  return {
    elo: (data.elo_set_grass as number | null) ?? (data.elo_overall as number | null) ?? null,
    tour: data.tour as 'atp' | 'wta' | null,
  };
}

function buildFinalScore(periods: Record<string, { home: number; away: number }> | undefined): string | null {
  if (!periods) return null;
  const keys = Object.keys(periods).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const p = periods[k];
    if (p.home === 0 && p.away === 0) continue;
    parts.push(`${p.home}-${p.away}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

async function settleMatch(srMatchId: number, finalWinner: 'A' | 'B', finalScore: string | null): Promise<{ snapshots: number; picks: number }> {
  const settledAt = new Date().toISOString();
  // Backfill outcome em todas as snapshots deste match
  const { count: snapshotsUpdated } = await supabase
    .from('live_state')
    .update({ final_winner: finalWinner, final_score: finalScore, settled_at: settledAt }, { count: 'exact' })
    .eq('sr_match_id', srMatchId)
    .is('final_winner', null);

  // Settle live_picks abertos deste match
  const { data: openPicks } = await supabase
    .from('live_picks')
    .select('id, selection, live_odd, stake')
    .eq('sr_match_id', srMatchId)
    .is('result', null);

  let picksSettled = 0;
  for (const pick of openPicks ?? []) {
    // Defensive: picks que cheguem ao fim do match sem live_odd não são
    // apostáveis. Em vez de marcar W/L cosméticos com pl=null (inflam
    // contagem de wins sem contribuir para PnL), apagamos. Cinto extra
    // ao requisito já existente no emit, mas cobre eventual race onde
    // a odd existia ao emitir e desapareceu antes do settle.
    if (pick.live_odd == null) {
      await supabase.from('live_picks').delete().eq('id', pick.id);
      continue;
    }
    const sel = pick.selection as 'A' | 'B' | string;
    const won = sel === finalWinner;
    const odd = Number(pick.live_odd);
    const stake = Number(pick.stake ?? 1);
    const pl = won ? +(stake * (odd - 1)).toFixed(2) : -stake;
    const { error } = await supabase
      .from('live_picks')
      .update({ result: won ? 'win' : 'loss', pl, settled_at: settledAt })
      .eq('id', pick.id);
    if (!error) picksSettled++;
  }

  return { snapshots: snapshotsUpdated ?? 0, picks: picksSettled };
}

/**
 * Só emite picks em "break moments": transições naturais do jogo onde
 * os jogadores estão em changeover / set break e a probabilidade do
 * modelo refletiu um game completo, não um spike intra-game.
 *
 * - Set break: total de sets aumentou desde o snapshot anterior
 * - Game break: game_a OR game_b mudou E o total de games joga em 3,
 *   5, 7 ou 9 (changeovers tradicionais) OU estamos prestes a entrar
 *   em tiebreak (game 6-6 acabou de ser atingido)
 *
 * Razão: emitir picks no meio de games gera ruído (spikes de 1
 * snapshot que voltam logo). Em break moments o modelo digeriu o
 * game inteiro e a prob é estável até ao próximo game.
 */
function isBreakMoment(
  prev: { set_a: number; set_b: number; game_a: number; game_b: number; tiebreak: boolean } | null,
  cur: { sA: number; sB: number; gA: number; gB: number; tiebreak: boolean },
): boolean {
  if (!prev) return false;
  // Set break — algum dos sets incrementou
  if (cur.sA > prev.set_a || cur.sB > prev.set_b) return true;
  // Game break — algum dos games mudou
  const gameChanged = cur.gA !== prev.game_a || cur.gB !== prev.game_b;
  if (!gameChanged) return false;
  // Just-entered tiebreak (6-6)
  if (cur.gA === 6 && cur.gB === 6 && !prev.tiebreak) return true;
  // Changeover natural: total games joga em ímpar (3, 5, 7, 9, 11)
  const total = cur.gA + cur.gB;
  return total === 3 || total === 5 || total === 7 || total === 9 || total === 11;
}

async function maybeEmitPick(opts: {
  srMatchId: number;
  snapshotId: number | null;
  state: { sA: number; sB: number; gA: number; gB: number; ptA: number; ptB: number; server: 'A' | 'B'; tiebreak: boolean };
  prevState: { set_a: number; set_b: number; game_a: number; game_b: number; tiebreak: boolean } | null;
  matchProb: number;
  importance: number;
  // null em duplas — SR trata a dupla como team único sem player ids
  playerAId: number | null;
  playerBId: number | null;
  nameA: string;
  nameB: string;
  tournamentSlug: string;
}): Promise<boolean> {
  const { matchProb, importance, state, prevState } = opts;

  // Break-moment gate: só emite em changeover (after games 3, 5, 7, 9),
  // antes do TB, ou em set break. Bloqueia spikes intra-game.
  if (!isBreakMoment(prevState, state)) return false;

  // Anti-volatility guard: nunca emite em estados de alta importância (BP críticos,
  // set points apertados). Captura sinais quando o modelo está confortável.
  if (importance > 0.18) return false;

  // Convicção mínima: só emite quando o modelo divergiu meaningfully de 50/50
  let selection: 'A' | 'B';
  let conviction: number;
  if (matchProb >= 0.62) {
    selection = 'A';
    conviction = matchProb;
  } else if (matchProb <= 0.38) {
    selection = 'B';
    conviction = 1 - matchProb;
  } else {
    return false;
  }

  const grade = conviction >= 0.75 ? 'A' : conviction >= 0.65 ? 'B' : 'C';

  // Regra de emissão: SÓ grade A (convicção >= 0.75). B/C ficam de fora
  // porque o yield histórico delas não justifica o ruído.
  if (grade !== 'A') return false;

  // Regra de emissão: no MÁXIMO 1 pick por set neste match, independente
  // de selecção. Se já existe uma pick para (match, set_a, set_b) na DB,
  // ignoramos. (O unique index actual é por game-state, demasiado fino.)
  const { count: existingInSet } = await supabase
    .from('live_picks')
    .select('id', { count: 'exact', head: true })
    .eq('sr_match_id', opts.srMatchId)
    .eq('set_a', state.sA)
    .eq('set_b', state.sB);
  if ((existingInSet ?? 0) > 0) return false;

  // Regra de emissão: SÓ emite se houver odd live disponível para este
  // match e selecção, captada nos últimos 5 minutos. Bloqueia o caso
  // "pick fica órfã sem odd → não é apostável → enche o histórico de
  // wins/losses virtuais sem PnL real". A odd é embutida na pick à
  // partida — picks nascem completas.
  const FRESH_ODD_MS = 5 * 60 * 1000;
  const since = new Date(Date.now() - FRESH_ODD_MS).toISOString();
  const { data: latestOdd } = await supabase
    .from('live_odds_history')
    .select('odd_a, odd_b, source, captured_at')
    .eq('sr_match_id', opts.srMatchId)
    .gt('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const oddRaw = selection === 'A' ? latestOdd?.odd_a : latestOdd?.odd_b;
  const liveOdd = oddRaw != null ? Number(oddRaw) : null;
  if (liveOdd == null || !Number.isFinite(liveOdd)) return false;

  // Caps de viabilidade (mesmos limites usados no attach):
  // odd ∈ [1.25, 4.0] e edge ≤ 100%. Aqui é cinto-e-suspensórios — se
  // a odd live cair fora, nem chega a entrar na DB.
  if (liveOdd < 1.25 || liveOdd > 4.0) return false;
  const edgePct = +((conviction * liveOdd - 1) * 100).toFixed(2);
  if (edgePct > 100) return false;
  // Só emite picks +EV — sem valor de mercado, não há recomendação
  if (edgePct <= 0) return false;

  const scoreDesc = `${state.sA}-${state.sB} sets · ${state.tiebreak ? 'TB' : `${state.gA}-${state.gB}`} game`;

  const { error } = await supabase
    .from('live_picks')
    .upsert({
      sr_match_id: opts.srMatchId,
      state_snapshot_id: opts.snapshotId,
      set_a: state.sA, set_b: state.sB,
      game_a: state.gA, game_b: state.gB,
      point_a: state.ptA, point_b: state.ptB,
      server: state.server,
      tiebreak: state.tiebreak,
      score_description: scoreDesc,
      player_a_id: opts.playerAId,
      player_b_id: opts.playerBId,
      name_a: opts.nameA,
      name_b: opts.nameB,
      tournament_slug: opts.tournamentSlug,
      selection,
      market: 'match_winner',
      model_prob: +conviction.toFixed(4),
      point_importance: +importance.toFixed(4),
      grade,
      stake: 1,
      live_odd: liveOdd,
      live_odd_source: latestOdd?.source ?? null,
      edge_pct: edgePct,
    }, { onConflict: 'sr_match_id,selection,set_a,set_b,game_a,game_b', ignoreDuplicates: true });

  return !error;
}

async function processMatch(m: SrSeasonMatch, season: typeof ACTIVE_SEASONS[number]): Promise<{
  ok: boolean; reason?: string; settled?: boolean; pickEmitted?: boolean;
}> {
  // Pull último snapshot deste match + verifica se já settled — UMA query.
  // Stats carry-forward incluindo totals (denominador para Bayes).
  const { data: lastSnap } = await supabase
    .from('live_state')
    .select('id, captured_at, final_winner, set_a, set_b, game_a, game_b, tiebreak, aces_a, aces_b, df_a, df_b, bp_won_a, bp_won_b, bp_total_a, bp_total_b, serve_pts_won_a, serve_pts_won_b, serve_pts_total_a, serve_pts_total_b, first_serve_won_a, first_serve_won_b, first_serve_in_a, first_serve_in_b')
    .eq('sr_match_id', m._id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastSnap?.final_winner) return { ok: false, reason: 'already_settled' };

  const get = await sr<{ doc: Array<{ data: SrMatchGet }> }>(`match_get/${m._id}`);
  const data = get?.doc?.[0]?.data;
  if (!data) return { ok: false, reason: 'no_match_get' };

  const running = data.timeinfo?.running === true;
  const winnerCode = data.result?.winner;
  const justEnded = !running && Boolean(data.ended_uts) && (winnerCode === 'home' || winnerCode === 'away');

  // Blip suppression: SR reporta timeinfo.running=false brevemente entre
  // pontos / mudanças de saque, e isso causa gaps de 2-5min nos snapshots
  // porque ignorávamos essas iterações. Se a última snapshot deste match
  // é recente (<90s) e estava running=true, tratamos como continuação —
  // gravamos snapshot com running=true e carry-forward do estado
  // conhecido, para o utilizador não ver "desactualizado".
  const lastAgeMs = lastSnap ? Date.now() - new Date(lastSnap.captured_at).getTime() : Infinity;
  const isContinuation = !running && !justEnded && lastAgeMs < 90_000;

  if (!running && !justEnded && !isContinuation) {
    return { ok: false, reason: 'not_running' };
  }
  const effectiveRunning = running || isContinuation;

  const state = buildState(data);
  if (!state) return { ok: false, reason: 'state_unparseable' };

  // Wimbledon: singles masculinos BO5; tudo o resto (WTA + todas as
  // duplas desde 2022) é BO3.
  if (season.tour === 'atp' && !season.isDoubles && season.tournamentSlug.includes('wimbledon')) {
    state.bestOf = 5;
  } else {
    state.bestOf = 3;
  }

  // detailsextended (~1.5s/call SR): refresh em bucket de 30s.
  // Snapshots cabem em buckets de 30s — se o último snapshot caiu num
  // bucket diferente do atual, refrescamos stats; senão, carry-forward.
  // (Antes usávamos lastAgeMs > 5min mas snapshots vêm a cada 25s →
  //  lastAgeMs nunca atingia 5min, logo stats ficavam congeladas após a
  //  1ª snapshot do match.)
  const BUCKET_MS = 30 * 1000;
  const curBucket = Math.floor(Date.now() / BUCKET_MS);
  const lastBucket = lastSnap ? Math.floor(new Date(lastSnap.captured_at).getTime() / BUCKET_MS) : -1;
  const needsStats = !lastSnap || justEnded || curBucket !== lastBucket;
  let stats: SrDetailsExtended | null = null;
  if (needsStats) {
    const det = await sr<{ doc: Array<{ data: SrDetailsExtended }> }>(`match_detailsextended/${m._id}`);
    stats = det?.doc?.[0]?.data ?? null;
  }
  const aces = pickStat(stats, '130');
  const df = pickStat(stats, '132');
  const bpWon = pickStat(stats, '139');                       // "4/9" → 4 (won)
  const bpTotal = pickStatDenom(stats, '139', 'fraction');     // "4/9" → 9 (total)
  const servePts = pickStat(stats, '141');                    // "64/20/84" → 64 (won)
  const servePtsTotal = pickStatDenom(stats, '141', 'triple'); // "64/20/84" → 84 (total)
  // 1st Serve Pts. Won: triple "won/lost/total" → guardamos como % (won/total*100).
  // Era key '1410' (= Receiver Points Won) que estava errado.
  const fsWonNum = pickStat(stats, '137');
  const fsWonDen = pickStatDenom(stats, '137', 'triple');
  // 1st Serve In: key 1189, triple "in/out/total" → % de 1ºs serviços bem colocados.
  const fsInNum = pickStat(stats, '1189');
  const fsInDen = pickStatDenom(stats, '1189', 'triple');
  const fsPct = (n: number | null, d: number | null) =>
    n != null && d != null && d > 0 ? +(100 * n / d).toFixed(2) : null;

  // Carry-forward de stats + totals para Bayes update vir do último snapshot
  // se este snapshot não fetched detailsextended.
  const sptWonA = servePts.a ?? lastSnap?.serve_pts_won_a ?? null;
  const sptWonB = servePts.b ?? lastSnap?.serve_pts_won_b ?? null;
  const sptTotalA = servePtsTotal.a ?? lastSnap?.serve_pts_total_a ?? null;
  const sptTotalB = servePtsTotal.b ?? lastSnap?.serve_pts_total_b ?? null;

  const playerMap = await resolveSrPlayers([
    { sr_team_id: data.teams.home._id, name: data.teams.home.name },
    { sr_team_id: data.teams.away._id, name: data.teams.away.name },
  ]);
  const playerAId = playerMap.get(data.teams.home._id) ?? null;
  const playerBId = playerMap.get(data.teams.away._id) ?? null;

  let pAprior: number | null = null;
  let pBprior: number | null = null;
  let matchProb: number | null = null;
  let importance: number | null = null;
  let pAlive: number | null = null;
  let pBlive: number | null = null;

  // Priors: singles via ELO individual (players resolvidos por
  // sr_player_map); duplas via team ELO doubles (média do par,
  // resolvido por apelido+inicial do nome de equipa SR).
  let eloPairFound: { eloA: number; eloB: number; tour: 'atp' | 'wta' } | null = null;
  if (season.isDoubles) {
    const isMixed = season.tournamentSlug.includes('mistas');
    const [teamEloA, teamEloB] = await Promise.all([
      resolveDoublesTeamElo(data.teams.home.name, isMixed ? null : season.tour),
      resolveDoublesTeamElo(data.teams.away.name, isMixed ? null : season.tour),
    ]);
    if (teamEloA != null && teamEloB != null) {
      eloPairFound = { eloA: teamEloA, eloB: teamEloB, tour: season.tour };
    }
  } else if (playerAId && playerBId) {
    const [eA, eB] = await Promise.all([fetchPlayerEloTour(playerAId), fetchPlayerEloTour(playerBId)]);
    if (eA?.elo && eB?.elo && eA.tour && eB.tour && eA.tour === eB.tour) {
      eloPairFound = { eloA: eA.elo, eloB: eB.elo, tour: eA.tour as 'atp' | 'wta' };
    }
  }

  if (eloPairFound) {
    const priors = priorsFromElo({
      eloA: eloPairFound.eloA,
      eloB: eloPairFound.eloB,
      tour: eloPairFound.tour,
      surface: 'grass',
    });
    pAprior = priors.pA;
    pBprior = priors.pB;
    // Bayesian update: se temos serve_pts_won/total deste match,
    // ajusta p_serve do prior em direcção ao observado. k=80 (prior
    // strength ~ 1.5 sets de serviço). Se sem dados, pAlive = prior.
    pAlive = sptWonA != null && sptTotalA != null && sptTotalA > 0
      ? bayesianServeUpdate(pAprior, sptWonA, sptTotalA, 80)
      : pAprior;
    pBlive = sptWonB != null && sptTotalB != null && sptTotalB > 0
      ? bayesianServeUpdate(pBprior, sptWonB, sptTotalB, 80)
      : pBprior;
    matchProb = matchWinProb(state, pAlive, pBlive);
    importance = pointImportance(state, pAlive, pBlive);
  }

  const finalWinner = justEnded ? (winnerCode === 'home' ? 'A' : 'B') as 'A' | 'B' : null;
  const finalScore = justEnded ? buildFinalScore(data.periods) : null;

  const { data: inserted } = await supabase
    .from('live_state')
    .insert({
      sr_match_id: data._id,
      sr_season_id: data._seasonid,
      sr_tournament_id: data._utid,
      tournament_slug: season.tournamentSlug,
      set_a: state.sA, set_b: state.sB,
      game_a: state.gA, game_b: state.gB,
      point_a: state.ptA, point_b: state.ptB,
      server: state.server,
      tiebreak: state.tiebreak,
      best_of: state.bestOf,
      match_finished: justEnded,
      final_winner: finalWinner,
      final_score: finalScore,
      settled_at: justEnded ? new Date().toISOString() : null,
      player_a_id: playerAId,
      player_b_id: playerBId,
      sr_team_a_id: data.teams.home._id,
      sr_team_b_id: data.teams.away._id,
      name_a: data.teams.home.name,
      name_b: data.teams.away.name,
      // Stats com carry-forward de lastSnap. Agora tudo numérico
      // (string-format "X/Y/Z" tratado por parseStat*).
      aces_a: aces.a ?? lastSnap?.aces_a ?? null,
      aces_b: aces.b ?? lastSnap?.aces_b ?? null,
      df_a:   df.a   ?? lastSnap?.df_a   ?? null,
      df_b:   df.b   ?? lastSnap?.df_b   ?? null,
      bp_won_a: bpWon.a ?? lastSnap?.bp_won_a ?? null,
      bp_won_b: bpWon.b ?? lastSnap?.bp_won_b ?? null,
      bp_total_a: bpTotal.a ?? lastSnap?.bp_total_a ?? null,
      bp_total_b: bpTotal.b ?? lastSnap?.bp_total_b ?? null,
      serve_pts_won_a: sptWonA,
      serve_pts_won_b: sptWonB,
      serve_pts_total_a: sptTotalA,
      serve_pts_total_b: sptTotalB,
      first_serve_won_a: fsPct(fsWonNum.a, fsWonDen.a) ?? lastSnap?.first_serve_won_a ?? null,
      first_serve_won_b: fsPct(fsWonNum.b, fsWonDen.b) ?? lastSnap?.first_serve_won_b ?? null,
      first_serve_in_a:  fsPct(fsInNum.a,  fsInDen.a)  ?? lastSnap?.first_serve_in_a  ?? null,
      first_serve_in_b:  fsPct(fsInNum.b,  fsInDen.b)  ?? lastSnap?.first_serve_in_b  ?? null,
      p_a_serve_prior: pAprior,
      p_b_serve_prior: pBprior,
      p_a_serve_live: pAlive,
      p_b_serve_live: pBlive,
      match_win_prob_a: matchProb,
      point_importance: importance,
      running: effectiveRunning,
    })
    .select('id')
    .single();

  // ── #1 Settlement: backfill outcome em todas as snapshots + close picks ────
  if (justEnded && finalWinner) {
    await settleMatch(data._id, finalWinner, finalScore);
    return { ok: true, settled: true };
  }

  // ── #2 Pseudo-pick: emite quando modelo divergiu e estado é estável ───────
  // Duplas não têm player_a_id/b_id (SR trata a dupla como team único) —
  // a identificação fica pelos nomes de equipa em name_a/name_b.
  let pickEmitted = false;
  const playersOk = season.isDoubles || (playerAId != null && playerBId != null);
  if (
    running &&
    matchProb != null &&
    importance != null &&
    playersOk &&
    inserted?.id != null
  ) {
    pickEmitted = await maybeEmitPick({
      srMatchId: data._id,
      snapshotId: inserted.id,
      state: { sA: state.sA, sB: state.sB, gA: state.gA, gB: state.gB, ptA: state.ptA, ptB: state.ptB, server: state.server, tiebreak: state.tiebreak },
      prevState: lastSnap ? {
        set_a: lastSnap.set_a as number,
        set_b: lastSnap.set_b as number,
        game_a: lastSnap.game_a as number,
        game_b: lastSnap.game_b as number,
        tiebreak: lastSnap.tiebreak as boolean,
      } : null,
      matchProb,
      importance,
      playerAId,
      playerBId,
      nameA: data.teams.home.name,
      nameB: data.teams.away.name,
      tournamentSlug: season.tournamentSlug,
    });
  }

  return { ok: true, pickEmitted };
}

export async function pollOnce(): Promise<{ checked: number; running: number; settled: number; picks: number; errors: number }> {
  let checked = 0, running = 0, settled = 0, picks = 0, errors = 0;
  const nowUts = Math.floor(Date.now() / 1000);
  const CONCURRENCY = 12;

  // Fetch fixtures das seasons em paralelo (não serial) + junta os
  // candidatos numa lista única. Antes ATP corria totalmente antes de
  // WTA começar, dobrando o cycle time. Agora ambas em paralelo.
  const seasonFixtures = await Promise.all(
    ACTIVE_SEASONS.map(async (season) => {
      const fixtures = await sr<{ doc: Array<{ data: { matches: SrSeasonMatch[] } }> }>(
        `stats_season_fixtures2/${season.id}/1`,
      );
      const matches = fixtures?.doc?.[0]?.data?.matches ?? [];
      const candidatesAll = matches
        .filter(m => {
          const uts = m.time?.uts ?? 0;
          return uts > nowUts - 48 * 3600 && uts < nowUts + 1800;
        })
        .sort((a, b) => Math.abs((a.time?.uts ?? 0) - nowUts) - Math.abs((b.time?.uts ?? 0) - nowUts));
      // 24 por season = até 48 candidatos totais (ATP + WTA)
      return { season, candidates: candidatesAll.slice(0, 24) };
    }),
  );

  // Alterna round-robin entre seasons para que ATP e WTA fiquem
  // igualmente distribuídos nos primeiros batches (evita starvar uma
  // delas se o total exceder 24-32 candidatos).
  const interleaved: Array<{ m: SrSeasonMatch; season: typeof ACTIVE_SEASONS[number] }> = [];
  const maxLen = Math.max(...seasonFixtures.map(s => s.candidates.length));
  for (let i = 0; i < maxLen; i++) {
    for (const s of seasonFixtures) {
      if (i < s.candidates.length) interleaved.push({ m: s.candidates[i], season: s.season });
    }
  }

  for (let i = 0; i < interleaved.length; i += CONCURRENCY) {
    const batch = interleaved.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(({ m, season }) => processMatch(m, season)));
    for (const r of results) {
      checked++;
      if (r.status === 'rejected') { errors++; continue; }
      if (r.value.ok) running++;
      if (r.value.settled) settled++;
      if (r.value.pickEmitted) picks++;
    }
  }

  return { checked, running, settled, picks, errors };
}
