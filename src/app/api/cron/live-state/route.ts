/**
 * Cron: poll Sportradar para matches Wimbledon em curso, computar
 * o nosso modelo live, inserir snapshot em live_state.
 *
 * Vercel cron min é 60s. Para 20s entre polls fazemos 3 iterações
 * dentro de um único handler (3 × 20s = ~60s wall clock).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  priorsFromElo,
  bayesianServeUpdate,
  matchWinProb,
  pointImportance,
  type MatchState,
  type Server,
} from '@/lib/live-markov';
import { resolveSrPlayers } from '@/lib/sr-player-match';

export const dynamic = 'force-dynamic';
// Hobby plan: max 10s. Endpoint faz UM poll cycle por invocação.
// Loop de polling fica no GitHub Action que chama este endpoint
// em ciclo a cada 5min.
export const maxDuration = 10;

// Hardcoded Wimbledon 2026 season IDs descobertos via gismo
// stats_season_fixtures2. ATP = 132572. WTA TBD (adicionar quando
// descobrirmos via SR).
const ACTIVE_SEASONS = [
  { id: 132572, tour: 'atp' as const, tournamentSlug: 'wimbledon-2026-atp' },
];

const SR_BASE = 'https://lmt.fn.sportradar.com/betradar/en/Etc:UTC/gismo';
const SR_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const SR_REFERER = 'https://widgets.sir.sportradar.com/betradar/en/live-match-tracker';
const SR_ORIGIN = 'https://widgets.sir.sportradar.com';

async function sr<T = unknown>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${SR_BASE}/${path}`, {
      headers: {
        'User-Agent': SR_UA,
        'Referer': SR_REFERER,
        'Origin': SR_ORIGIN,
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
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
  values: Record<string, { name: string; value: { home: number; away: number } }>;
}

function pickStat(d: SrDetailsExtended | null, key: string): { a: number | null; b: number | null } {
  const v = d?.values?.[key]?.value;
  return { a: v?.home ?? null, b: v?.away ?? null };
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
    const sel = pick.selection as 'A' | 'B' | string;
    const won = sel === finalWinner;
    const odd = pick.live_odd != null ? Number(pick.live_odd) : null;
    const stake = Number(pick.stake ?? 1);
    const pl = odd != null ? (won ? +(stake * (odd - 1)).toFixed(2) : -stake) : null;
    const { error } = await supabase
      .from('live_picks')
      .update({ result: won ? 'win' : 'loss', pl, settled_at: settledAt })
      .eq('id', pick.id);
    if (!error) picksSettled++;
  }

  return { snapshots: snapshotsUpdated ?? 0, picks: picksSettled };
}

async function maybeEmitPick(opts: {
  srMatchId: number;
  snapshotId: number | null;
  state: { sA: number; sB: number; gA: number; gB: number; ptA: number; ptB: number; server: 'A' | 'B'; tiebreak: boolean };
  matchProb: number;
  importance: number;
  playerAId: number;
  playerBId: number;
  nameA: string;
  nameB: string;
  tournamentSlug: string;
}): Promise<boolean> {
  const { matchProb, importance, state } = opts;

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
    }, { onConflict: 'sr_match_id,selection,set_a,set_b,game_a,game_b', ignoreDuplicates: true });

  return !error;
}

async function processMatch(m: SrSeasonMatch, season: typeof ACTIVE_SEASONS[number]): Promise<{
  ok: boolean; reason?: string; settled?: boolean; pickEmitted?: boolean;
}> {
  // Skip se já settled (evita re-processar e poupa Sportradar calls)
  const { data: existingSettled } = await supabase
    .from('live_state')
    .select('id')
    .eq('sr_match_id', m._id)
    .not('final_winner', 'is', null)
    .limit(1)
    .maybeSingle();
  if (existingSettled) return { ok: false, reason: 'already_settled' };

  const get = await sr<{ doc: Array<{ data: SrMatchGet }> }>(`match_get/${m._id}`);
  const data = get?.doc?.[0]?.data;
  if (!data) return { ok: false, reason: 'no_match_get' };

  const running = data.timeinfo?.running === true;
  const winnerCode = data.result?.winner;
  const justEnded = !running && Boolean(data.ended_uts) && (winnerCode === 'home' || winnerCode === 'away');

  if (!running && !justEnded) {
    return { ok: false, reason: 'not_running' };
  }

  const state = buildState(data);
  if (!state) return { ok: false, reason: 'state_unparseable' };

  if (season.tour === 'atp' && season.tournamentSlug.includes('wimbledon')) {
    state.bestOf = 5;
  } else {
    state.bestOf = 3;
  }

  const det = await sr<{ doc: Array<{ data: SrDetailsExtended }> }>(`match_detailsextended/${m._id}`);
  const stats = det?.doc?.[0]?.data ?? null;
  const aces = pickStat(stats, '130');
  const df = pickStat(stats, '132');
  const bpWon = pickStat(stats, '139');
  const servePts = pickStat(stats, '141');
  const fsWon = pickStat(stats, '1410');

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

  if (playerAId && playerBId) {
    const [eA, eB] = await Promise.all([fetchPlayerEloTour(playerAId), fetchPlayerEloTour(playerBId)]);
    if (eA?.elo && eB?.elo && eA.tour && eB.tour && eA.tour === eB.tour) {
      const priors = priorsFromElo({
        eloA: eA.elo,
        eloB: eB.elo,
        tour: eA.tour as 'atp' | 'wta',
        surface: 'grass',
      });
      pAprior = priors.pA;
      pBprior = priors.pB;
      pAlive = pAprior;
      pBlive = pBprior;
      matchProb = matchWinProb(state, pAlive, pBlive);
      importance = pointImportance(state, pAlive, pBlive);
    }
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
      aces_a: aces.a, aces_b: aces.b,
      df_a: df.a, df_b: df.b,
      bp_won_a: bpWon.a, bp_won_b: bpWon.b,
      serve_pts_won_a: servePts.a, serve_pts_won_b: servePts.b,
      first_serve_won_a: fsWon.a, first_serve_won_b: fsWon.b,
      p_a_serve_prior: pAprior,
      p_b_serve_prior: pBprior,
      p_a_serve_live: pAlive,
      p_b_serve_live: pBlive,
      match_win_prob_a: matchProb,
      point_importance: importance,
      running,
    })
    .select('id')
    .single();

  // ── #1 Settlement: backfill outcome em todas as snapshots + close picks ────
  if (justEnded && finalWinner) {
    await settleMatch(data._id, finalWinner, finalScore);
    return { ok: true, settled: true };
  }

  // ── #2 Pseudo-pick: emite quando modelo divergiu e estado é estável ───────
  let pickEmitted = false;
  if (
    running &&
    matchProb != null &&
    importance != null &&
    playerAId != null &&
    playerBId != null &&
    inserted?.id != null
  ) {
    pickEmitted = await maybeEmitPick({
      srMatchId: data._id,
      snapshotId: inserted.id,
      state: { sA: state.sA, sB: state.sB, gA: state.gA, gB: state.gB, ptA: state.ptA, ptB: state.ptB, server: state.server, tiebreak: state.tiebreak },
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

async function pollOnce(): Promise<{ checked: number; running: number; settled: number; picks: number; errors: number }> {
  let checked = 0, running = 0, settled = 0, picks = 0, errors = 0;
  const nowUts = Math.floor(Date.now() / 1000);

  for (const season of ACTIVE_SEASONS) {
    const fixtures = await sr<{ doc: Array<{ data: { matches: SrSeasonMatch[] } }> }>(
      `stats_season_fixtures2/${season.id}/1`,
    );
    const matches = fixtures?.doc?.[0]?.data?.matches ?? [];
    const candidates = matches.filter(m => {
      const uts = m.time?.uts ?? 0;
      return uts > nowUts - 6 * 3600 && uts < nowUts + 3600;
    });
    for (const m of candidates) {
      checked++;
      try {
        const r = await processMatch(m, season);
        if (r.ok) running++;
        if (r.settled) settled++;
        if (r.pickEmitted) picks++;
      } catch (e) {
        errors++;
        console.error(`[live-state] match ${m._id}:`, e);
      }
    }
  }

  return { checked, running, settled, picks, errors };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const t0 = Date.now();
  const r = await pollOnce();
  return NextResponse.json({ ok: true, ms: Date.now() - t0, ...r });
}

export async function GET(req: NextRequest) {
  // Vercel cron usa GET por padrão. Alias para POST.
  return POST(req);
}
