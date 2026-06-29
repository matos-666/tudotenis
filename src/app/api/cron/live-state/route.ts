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
export const maxDuration = 60;

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
  _dt: { uts: number };
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

async function processMatch(m: SrSeasonMatch, season: typeof ACTIVE_SEASONS[number]): Promise<{
  ok: boolean; reason?: string;
}> {
  const get = await sr<{ doc: Array<{ data: SrMatchGet }> }>(`match_get/${m._id}`);
  const data = get?.doc?.[0]?.data;
  if (!data) return { ok: false, reason: 'no_match_get' };

  const running = data.timeinfo?.running === true;
  if (!running && !data.ended_uts) {
    return { ok: false, reason: 'not_running' };
  }

  const state = buildState(data);
  if (!state) return { ok: false, reason: 'state_unparseable' };

  // Force BO5 for men's slams (covers Wimbledon ATP)
  if (season.tour === 'atp' && season.tournamentSlug.includes('wimbledon')) {
    state.bestOf = 5;
  } else {
    state.bestOf = 3;
  }

  // Stats
  const det = await sr<{ doc: Array<{ data: SrDetailsExtended }> }>(`match_detailsextended/${m._id}`);
  const stats = det?.doc?.[0]?.data ?? null;
  const aces = pickStat(stats, '130');
  const df = pickStat(stats, '132');
  const bpWon = pickStat(stats, '139');
  const ptsTotal = pickStat(stats, '136');     // Points won (we use as proxy)
  const servePts = pickStat(stats, '141');      // Service Points Won
  const fsWon = pickStat(stats, '1410');         // 1st serve points won
  // For Bayesian update we need (s, n) — serve pts won, serve pts total
  // Sportradar exposes "Service Points Won" but total served = serve pts won + serve pts lost.
  // Without "service points played" we approximate via aces + DFs + 1st/2nd serve splits.
  // Iteration v1: skip Bayes if we can't get clean (s, n). Use prior only.

  // Player resolution
  const playerMap = await resolveSrPlayers([
    { sr_team_id: data.teams.home._id, name: data.teams.home.name },
    { sr_team_id: data.teams.away._id, name: data.teams.away.name },
  ]);
  const playerAId = playerMap.get(data.teams.home._id) ?? null;
  const playerBId = playerMap.get(data.teams.away._id) ?? null;

  // ELO priors
  let pAprior: number | null = null;
  let pBprior: number | null = null;
  let matchProb: number | null = null;
  let setProb: number | null = null;
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

  await supabase.from('live_state').insert({
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
    match_finished: !running && data.ended_uts ? true : false,
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
    set_win_prob_a: setProb,
    point_importance: importance,
    running,
  });

  return { ok: true };
}

async function pollOnce(): Promise<{ checked: number; running: number; errors: number }> {
  let checked = 0, running = 0, errors = 0;
  const nowUts = Math.floor(Date.now() / 1000);

  for (const season of ACTIVE_SEASONS) {
    const fixtures = await sr<{ doc: Array<{ data: { matches: SrSeasonMatch[] } }> }>(
      `stats_season_fixtures2/${season.id}/1`,
    );
    const matches = fixtures?.doc?.[0]?.data?.matches ?? [];
    // Candidatos: matches cuja hora de início é nas últimas 6h ou nas próximas 1h
    const candidates = matches.filter(m => {
      const uts = m._dt?.uts ?? 0;
      return uts > nowUts - 6 * 3600 && uts < nowUts + 3600;
    });
    for (const m of candidates) {
      checked++;
      try {
        const r = await processMatch(m, season);
        if (r.ok) running++;
      } catch (e) {
        errors++;
        console.error(`[live-state] match ${m._id}:`, e);
      }
    }
  }

  return { checked, running, errors };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const results: Array<{ iter: number; checked: number; running: number; errors: number; ms: number }> = [];
  const startAll = Date.now();
  const ITERATIONS = 3;
  const INTERVAL_MS = 20000;

  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = Date.now();
    const r = await pollOnce();
    results.push({ iter: i, ms: Date.now() - t0, ...r });
    if (i < ITERATIONS - 1) {
      const elapsed = Date.now() - t0;
      const sleep = Math.max(0, INTERVAL_MS - elapsed);
      if (sleep > 0) await new Promise(res => setTimeout(res, sleep));
    }
  }

  return NextResponse.json({
    ok: true,
    total_ms: Date.now() - startAll,
    iterations: results,
  });
}

export async function GET(req: NextRequest) {
  // Vercel cron usa GET por padrão. Alias para POST.
  return POST(req);
}
