/**
 * Cron: ingest de live odds via The Odds API.
 *
 * Fluxo:
 *   1. Pull running matches de live_state_latest (Sportradar IDs + nomes)
 *   2. Fetch slate Wimbledon ATP+WTA da OddsAPI (1 call por competição)
 *   3. Match Sportradar names ("Last, First") → OddsAPI ("First Last")
 *      via fuzzy: exact normalized OR last-name-only
 *   4. Para cada match resolvido:
 *      - Insert em live_odds_history (uma linha por (match, source, ts))
 *      - Update em live_picks abertos: live_odd + edge_pct
 *
 * Cost: 2 calls por execução x 12 execuções/h (GHA cron a cada 5min x
 *   12 loops por run) = 24/h aprox 580/dia aprox 17k/mês.
 *   Plano Pro do OddsAPI cobre.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

const supabase = getServiceSupabase();
import { fetchTennisLiveOdds, extractBestOdds, matchSrToOddsApi } from '@/lib/odds-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const SPORT_KEYS = ['tennis_atp_wimbledon', 'tennis_wta_wimbledon'];

interface LiveMatchRef {
  sr_match_id: number;
  name_a: string | null;
  name_b: string | null;
}

async function fetchRunningMatches(): Promise<LiveMatchRef[]> {
  const { data } = await supabase
    .from('live_state_latest')
    .select('sr_match_id, name_a, name_b')
    .eq('running', true)
    .limit(60);
  return ((data ?? []) as LiveMatchRef[]).filter(m => m.name_a && m.name_b);
}

// Caps de viabilidade (ver doc em live-odds-ingest/route.ts).
const ODD_MIN = 1.25;
const ODD_MAX = 4.0;
const EDGE_MAX_PCT = 100;

async function attachOddsToOpenPicks(srMatchId: number, oddA: number | null, oddB: number | null): Promise<number> {
  const { data: openPicks } = await supabase
    .from('live_picks')
    .select('id, selection, model_prob')
    .eq('sr_match_id', srMatchId)
    .is('result', null)
    .is('live_odd', null);

  let updated = 0;
  for (const pick of openPicks ?? []) {
    const sel = pick.selection as 'A' | 'B' | string;
    const odd = sel === 'A' ? oddA : sel === 'B' ? oddB : null;
    if (odd == null) continue;
    const modelProb = Number(pick.model_prob);
    const edgePct = +((modelProb * odd - 1) * 100).toFixed(2);

    if (odd < ODD_MIN || odd > ODD_MAX || edgePct > EDGE_MAX_PCT) {
      await supabase.from('live_picks').delete().eq('id', pick.id);
      continue;
    }

    const { error } = await supabase
      .from('live_picks')
      .update({ live_odd: odd, live_odd_source: 'oddsapi', edge_pct: edgePct })
      .eq('id', pick.id);
    if (!error) updated++;
  }
  return updated;
}

async function pollOddsOnce(): Promise<{
  checked: number;
  matched: number;
  captured: number;
  picks_updated: number;
  oa_calls: number;
}> {
  const matches = await fetchRunningMatches();
  if (matches.length === 0) {
    return { checked: 0, matched: 0, captured: 0, picks_updated: 0, oa_calls: 0 };
  }

  let oaCalls = 0;
  const oaPool: import('@/lib/odds-api').OddsApiMatch[] = [];
  for (const sportKey of SPORT_KEYS) {
    const slate = await fetchTennisLiveOdds(sportKey);
    oaCalls++;
    oaPool.push(...slate);
  }

  const mapping = matchSrToOddsApi(
    matches.map(m => ({ home: m.name_a!, away: m.name_b! })),
    oaPool,
  );

  let matched = 0, captured = 0, picksUpdated = 0;
  for (let i = 0; i < matches.length; i++) {
    const sr = matches[i];
    const oa = mapping.get(i);
    if (!oa) continue;
    matched++;

    const odds = extractBestOdds(oa);
    if (odds.oddHome == null && odds.oddAway == null) continue;

    // Determinar qual lado da OddsAPI é A (Sportradar home). Os nomes
    // OddsAPI são "First Last" e a "home_team" não corresponde sempre à
    // ordem da Sportradar — precisamos verificar com a normalization.
    const srHomeLast = (sr.name_a ?? '').split(',')[0].trim().toLowerCase();
    const oaHomeLast = oa.home_team.split(' ').slice(-1)[0].toLowerCase();
    const flipped = srHomeLast !== oaHomeLast;

    const oddA = flipped ? odds.oddAway : odds.oddHome;
    const oddB = flipped ? odds.oddHome : odds.oddAway;

    const { error } = await supabase.from('live_odds_history').insert({
      sr_match_id: sr.sr_match_id,
      source: 'oddsapi',
      odd_a: oddA,
      odd_b: oddB,
      raw_payload: {
        bookmakers: oa.bookmakers.length,
        best_a_book: flipped ? odds.bestAwayBook : odds.bestHomeBook,
        best_b_book: flipped ? odds.bestHomeBook : odds.bestAwayBook,
        ref_a: flipped ? odds.refAway : odds.refHome,
        ref_b: flipped ? odds.refHome : odds.refAway,
        ref_source: odds.refSource,
        oa_id: oa.id,
      },
    });
    if (!error) captured++;

    picksUpdated += await attachOddsToOpenPicks(sr.sr_match_id, oddA, oddB);
  }

  return { checked: matches.length, matched, captured, picks_updated: picksUpdated, oa_calls: oaCalls };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const t0 = Date.now();
  const r = await pollOddsOnce();
  return NextResponse.json({ ok: true, ms: Date.now() - t0, ...r });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
