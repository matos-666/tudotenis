/**
 * Ingest endpoint para pre-match picks scraped do Twin.
 *
 * Substitui o flow legacy TennisStats que falhava regularmente.
 * Single source — Twin dá-nos schedule + odds → modelo só tem que
 * matchear players e calcular EV.
 *
 * Payload:
 *   { source: 'twin', captured_at, matches: [{
 *     tour: 'atp'|'wta',
 *     tournament: string,
 *     name_a, name_b: string,    // "Last, First" format
 *     odd_a, odd_b: number,
 *     kickoff_date_text: string, // "Hoje", "Amanhã", "01/07"
 *     kickoff_time_text: string, // "12:10"
 *     twin_href: string,
 *   }] }
 *
 * Para cada match:
 *   1. Fuzzy match name → players table
 *   2. Lookup ELO surface-specific (Wimbledon=grass, USO=hard, etc)
 *   3. Compute model prob via eloProb + matchProb (BO3 ou BO5)
 *   4. EV = model_prob × odd - 1; pick lado mais positivo
 *   5. Insert em picks se EV ≥ 5% e ainda não existe
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { eloProb } from '@/lib/elo';

const supabase = getServiceSupabase();

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface IngestMatchSingles {
  tour: 'atp' | 'wta';
  tournament: string | null;
  is_doubles?: false;
  name_a: string;
  name_b: string;
  odd_a: number;
  odd_b: number;
  kickoff_date_text: string | null;
  kickoff_time_text: string | null;
  twin_href: string | null;
}

interface IngestMatchDoubles {
  tour: 'atp' | 'wta';
  tournament: string | null;
  is_doubles: true;
  t1_p1: string; t1_p2: string;
  t2_p1: string; t2_p2: string;
  odd_a: number;
  odd_b: number;
  kickoff_date_text: string | null;
  kickoff_time_text: string | null;
  twin_href: string | null;
}

type IngestMatch = IngestMatchSingles | IngestMatchDoubles;

interface IngestPayload {
  source?: string;
  captured_at?: string;
  matches?: IngestMatch[];
}

interface PlayerRow {
  id: number;
  name: string;
  slug: string;
  flag: string | null;
  tour: string;
  elo_overall: number | null;
  elo_set_overall: number | null;
  elo_set_hard: number | null;
  elo_set_clay: number | null;
  elo_set_grass: number | null;
}

function strip(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function lastNameToken(s: string): string {
  const t = s.trim();
  if (t.includes(',')) return strip(t.split(',')[0]);
  const tokens = t.split(/\s+/);
  return strip(tokens[tokens.length - 1] ?? '');
}

function firstInitial(s: string): string {
  const t = s.trim();
  if (t.includes(',')) {
    const first = t.split(',')[1]?.trim() ?? '';
    return (first[0] ?? '').toLowerCase();
  }
  const tokens = t.split(/\s+/);
  return (tokens[0]?.[0] ?? '').toLowerCase();
}

// Cache global pull-all (uma vez por request) — evita N queries
// supabase + ilike incoerente. ~3000 players × small select = ~150KB.
interface PlayerIndex {
  byTour: Map<string, Array<PlayerRow & { norm: string; last: string }>>;
}

async function buildPlayerIndex(): Promise<PlayerIndex & { _err?: string }> {
  const out: PlayerIndex & { _err?: string } = { byTour: new Map() };
  // 1786 active players cabe num único pull com limit alto. Sem pagination.
  const { data, error } = await supabase
    .from('players')
    .select('id, name, slug, flag, tour, elo_overall, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass')
    .eq('active', true)
    .limit(3000);
  if (error) { out._err = error.message; return out; }
  for (const p of (data ?? []) as PlayerRow[]) {
    const norm = strip(p.name);
    const tokens = p.name.split(/\s+/);
    const last = strip(tokens[tokens.length - 1] ?? '');
    const arr = out.byTour.get(p.tour) ?? [];
    arr.push({ ...p, norm, last });
    out.byTour.set(p.tour, arr);
  }
  return out;
}

function resolvePlayerFromIndex(scrapedName: string, tour: string, idx: PlayerIndex): PlayerRow | null {
  const cands = idx.byTour.get(tour) ?? [];
  if (cands.length === 0) return null;

  const last = lastNameToken(scrapedName);
  const init = firstInitial(scrapedName);
  if (!last) return null;

  // Target: Twin "Last, First" → strip = "lastfirst"; player DB "First Last" → strip = "firstlast"
  // Test both directions.
  const parts = scrapedName.split(',').map(s => s.trim());
  const reversedFull = parts.length === 2 ? strip(`${parts[1]} ${parts[0]}`) : strip(scrapedName);

  // 1. Exact reversed match (player DB format)
  let hit = cands.find(p => p.norm === reversedFull);
  // 2. Last-name match + first initial
  if (!hit) {
    hit = cands.find(p => p.last === last && (init === '' || p.norm.startsWith(init)));
  }
  // 3. Player whose norm contains both 'last' and 'firstinitial' start of any token
  if (!hit) {
    hit = cands.find(p => p.norm.endsWith(last) && (init === '' || p.norm.startsWith(init)));
  }
  // 4. Unique last-name match
  if (!hit) {
    const lastMatches = cands.filter(p => p.last === last);
    if (lastMatches.length === 1) hit = lastMatches[0];
  }

  return hit ?? null;
}

interface TournamentInfo { name: string; surface: 'hard' | 'clay' | 'grass' | 'indoor'; bestOf: number; }
function inferTournamentInfo(tournament: string | null, tour: 'atp' | 'wta'): TournamentInfo {
  const t = (tournament ?? '').toLowerCase();
  const isMen = tour === 'atp';
  if (t.includes('wimbledon')) return { name: tournament || 'Wimbledon', surface: 'grass', bestOf: isMen ? 5 : 3 };
  if (t.includes('us open'))   return { name: tournament || 'US Open', surface: 'hard', bestOf: isMen ? 5 : 3 };
  if (t.includes('french') || t.includes('roland')) return { name: tournament || 'Roland Garros', surface: 'clay', bestOf: isMen ? 5 : 3 };
  if (t.includes('australian')) return { name: tournament || 'Australian Open', surface: 'hard', bestOf: isMen ? 5 : 3 };
  // Heuristic: default to hard (most events)
  return { name: tournament || 'Unknown', surface: 'hard', bestOf: 3 };
}

function eloFor(p: PlayerRow, surface: 'hard' | 'clay' | 'grass' | 'indoor'): number | null {
  // 'indoor' colapsa para 'hard' (não há coluna dedicada).
  const eff = surface === 'indoor' ? 'hard' : surface;
  const key = `elo_set_${eff}` as 'elo_set_hard' | 'elo_set_clay' | 'elo_set_grass';
  return p[key] ?? p.elo_set_overall ?? p.elo_overall ?? null;
}

function getGrade(edge: number): 'A' | 'B' | 'C' {
  if (edge >= 12) return 'A';
  if (edge >= 8) return 'B';
  return 'C';
}

// ── DOUBLES ───────────────────────────────────────────────────────────────

interface DoublesPlayerRow {
  id: number;
  name: string;
  flag: string | null;
  doubles_matches: number | null;
  elo_doubles_overall: number | null;
  elo_doubles_hard: number | null;
  elo_doubles_clay: number | null;
  elo_doubles_grass: number | null;
}

// Threshold mínimo de matches jogados em duplas — abaixo disto o ELO é
// unreliable (média inicial 1500 puxa artificialmente). Alinha com o
// cron TennisStats existente.
const MIN_DBL_MATCHES = 10;
// Caps consistentes com singles + regras aplicadas no live_picks
const MIN_ODD = 1.25;
const MAX_ODD_DBL = 4.0;
const MIN_EV = 0.05;
const MAX_EV_DBL = 0.30;

function doublesEloForSurface(p: DoublesPlayerRow, surface: 'hard' | 'clay' | 'grass'): number | null {
  const key = `elo_doubles_${surface}` as 'elo_doubles_hard' | 'elo_doubles_clay' | 'elo_doubles_grass';
  return p[key] ?? p.elo_doubles_overall ?? null;
}

async function fetchDoublesPlayers(ids: number[]): Promise<Map<number, DoublesPlayerRow>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('players')
    .select('id, name, flag, doubles_matches, elo_doubles_overall, elo_doubles_hard, elo_doubles_clay, elo_doubles_grass')
    .in('id', ids);
  const out = new Map<number, DoublesPlayerRow>();
  for (const p of (data ?? []) as DoublesPlayerRow[]) out.set(p.id, p);
  return out;
}

function buildDoublesExternalKey(t1: string, t2: string, t3: string, t4: string, tournament: string | null, date: string): string {
  const clean = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const t = clean(tournament ?? 'unknown');
  const players = [clean(t1), clean(t2), clean(t3), clean(t4)].sort().join('_');
  return `twin:${date}:${t}:${players}`;
}

async function processDoubles(m: IngestMatchDoubles, idx: PlayerIndex): Promise<'inserted' | 'skipped'> {
  const p1 = resolvePlayerFromIndex(m.t1_p1, m.tour, idx);
  const p2 = resolvePlayerFromIndex(m.t1_p2, m.tour, idx);
  const p3 = resolvePlayerFromIndex(m.t2_p1, m.tour, idx);
  const p4 = resolvePlayerFromIndex(m.t2_p2, m.tour, idx);
  if (!p1 || !p2 || !p3 || !p4) return 'skipped';

  const dblPlayers = await fetchDoublesPlayers([p1.id, p2.id, p3.id, p4.id]);
  const dp1 = dblPlayers.get(p1.id);
  const dp2 = dblPlayers.get(p2.id);
  const dp3 = dblPlayers.get(p3.id);
  const dp4 = dblPlayers.get(p4.id);
  if (!dp1 || !dp2 || !dp3 || !dp4) return 'skipped';

  // Threshold de confidence
  for (const dp of [dp1, dp2, dp3, dp4]) {
    if ((dp.doubles_matches ?? 0) < MIN_DBL_MATCHES) return 'skipped';
  }

  const info = inferTournamentInfo(m.tournament, m.tour);
  const surface = info.surface as 'hard' | 'clay' | 'grass';

  const e1 = doublesEloForSurface(dp1, surface);
  const e2 = doublesEloForSurface(dp2, surface);
  const e3 = doublesEloForSurface(dp3, surface);
  const e4 = doublesEloForSurface(dp4, surface);
  if (e1 == null || e2 == null || e3 == null || e4 == null) return 'skipped';

  // Team ELO = média simples (aproximação padrão em modelos de duplas)
  const teamAElo = (e1 + e2) / 2;
  const teamBElo = (e3 + e4) / 2;

  const setProbA = eloProb(teamAElo, teamBElo);
  const matchProbA = Math.pow(setProbA, 2) * (3 - 2 * setProbA); // duplas = BO3
  const matchProbB = 1 - matchProbA;

  const evA = matchProbA * m.odd_a - 1;
  const evB = matchProbB * m.odd_b - 1;

  let teamSel: 1 | 2 | null = null;
  let pickOdd = 0;
  let pickEv = 0;
  if (evA >= MIN_EV && evA <= MAX_EV_DBL && m.odd_a >= MIN_ODD && m.odd_a <= MAX_ODD_DBL && evA >= evB) {
    teamSel = 1; pickOdd = m.odd_a; pickEv = evA;
  } else if (evB >= MIN_EV && evB <= MAX_EV_DBL && m.odd_b >= MIN_ODD && m.odd_b <= MAX_ODD_DBL) {
    teamSel = 2; pickOdd = m.odd_b; pickEv = evB;
  } else {
    return 'skipped';
  }

  const scheduled = parseKickoff(m.kickoff_date_text, m.kickoff_time_text);
  const dateStr = (scheduled ?? new Date().toISOString()).slice(0, 10);
  const externalKey = buildDoublesExternalKey(dp1.name, dp2.name, dp3.name, dp4.name, m.tournament, dateStr);

  // Insert doubles_match se ainda não existe
  const { data: existingMatch } = await supabase
    .from('doubles_matches')
    .select('id')
    .eq('external_key', externalKey)
    .limit(1);
  let doublesMatchId = existingMatch?.[0]?.id as number | undefined;
  if (!doublesMatchId) {
    const { data: newMatch, error: mErr } = await supabase.from('doubles_matches').insert({
      source: 'twin',
      external_key: externalKey,
      tournament_name: info.name,
      date: dateStr,
      scheduled_at: scheduled,
      surface,
      t1_p1_id: dp1.id, t1_p2_id: dp2.id,
      t2_p1_id: dp3.id, t2_p2_id: dp4.id,
      t1_p1_name: dp1.name, t1_p2_name: dp2.name,
      t2_p1_name: dp3.name, t2_p2_name: dp4.name,
    }).select('id').single();
    if (mErr || !newMatch) return 'skipped';
    doublesMatchId = newMatch.id as number;
  }

  // Dedup: já emitimos hoje esta pick?
  const today = new Date().toISOString().slice(0, 10);
  const { data: existingPick } = await supabase
    .from('doubles_picks')
    .select('id')
    .eq('doubles_match_id', doublesMatchId)
    .eq('team_selected', teamSel)
    .gte('posted_at', `${today}T00:00:00Z`)
    .limit(1);
  if (existingPick && existingPick.length > 0) return 'skipped';

  const evPct = Math.round(pickEv * 10000) / 100;
  const { error: pErr } = await supabase.from('doubles_picks').insert({
    doubles_match_id: doublesMatchId,
    external_key: externalKey,
    source: 'twin',
    team_selected: teamSel,
    t1_p1_id: dp1.id, t1_p2_id: dp2.id,
    t2_p1_id: dp3.id, t2_p2_id: dp4.id,
    t1_p1_name: dp1.name, t1_p2_name: dp2.name,
    t2_p1_name: dp3.name, t2_p2_name: dp4.name,
    t1_p1_flag: dp1.flag, t1_p2_flag: dp2.flag,
    t2_p1_flag: dp3.flag, t2_p2_flag: dp4.flag,
    market: 'Vencedora dupla',
    odd: pickOdd,
    edge_pct: evPct,
    grade: getGrade(evPct),
    stake: 10,
    tournament_name: info.name,
    surface,
    scheduled_at: scheduled,
  });
  return pErr ? 'skipped' : 'inserted';
}

function parseKickoff(dateText: string | null, timeText: string | null): string | null {
  if (!timeText || !/^\d{1,2}:\d{2}$/.test(timeText)) return null;
  const [h, m] = timeText.split(':').map(Number);
  const dt = new Date();
  const lower = (dateText ?? '').toLowerCase();
  if (lower.includes('amanh')) {
    dt.setUTCDate(dt.getUTCDate() + 1);
  } else if (/^\d{1,2}\/\d{1,2}/.test(lower)) {
    const [d, mo] = lower.split('/').map(Number);
    if (d && mo) {
      dt.setUTCMonth(mo - 1);
      dt.setUTCDate(d);
    }
  }
  // Twin times são Europe/Lisbon. Lisbon BST in summer = UTC+1.
  // Apenas como aproximação; admite-se ±1h de desvio.
  dt.setUTCHours(h - 1, m, 0, 0);
  return dt.toISOString();
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: IngestPayload;
  try { payload = (await req.json()) as IngestPayload; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const allMatches = (payload.matches ?? []).filter(m => m.odd_a > 1 && m.odd_b > 1);
  const singlesMatches = allMatches.filter((m): m is IngestMatchSingles => !m.is_doubles && !!(m as IngestMatchSingles).name_a && !!(m as IngestMatchSingles).name_b);
  const doublesMatches = allMatches.filter((m): m is IngestMatchDoubles => m.is_doubles === true);
  const matches = singlesMatches;
  if (allMatches.length === 0) {
    return NextResponse.json({ ok: true, received: 0, resolved: 0, inserted: 0, doubles_inserted: 0 });
  }

  const idx = await buildPlayerIndex();
  let resolved = 0, inserted = 0, skipped = 0;
  const debugSamples: Array<{ name_a: string; name_b: string; pA: string | null; pB: string | null }> = [];
  const indexDebug = {
    total_atp: idx.byTour.get('atp')?.length ?? 0,
    total_wta: idx.byTour.get('wta')?.length ?? 0,
    has_sinner: idx.byTour.get('atp')?.some(p => p.name.includes('Sinner')) ?? false,
    has_arnaldi: idx.byTour.get('atp')?.some(p => p.name.includes('Arnaldi')) ?? false,
    sample_atp_3: idx.byTour.get('atp')?.slice(0, 3).map(p => ({ name: p.name, norm: p.norm, last: p.last })) ?? [],
    err: idx._err ?? null,
  };

  for (const m of matches) {
    const pA = resolvePlayerFromIndex(m.name_a, m.tour, idx);
    const pB = resolvePlayerFromIndex(m.name_b, m.tour, idx);
    if (debugSamples.length < 5) {
      debugSamples.push({ name_a: m.name_a, name_b: m.name_b, pA: pA?.name ?? null, pB: pB?.name ?? null });
    }
    if (!pA || !pB) { skipped++; continue; }
    resolved++;

    const info = inferTournamentInfo(m.tournament, m.tour);
    const eloA = eloFor(pA, info.surface);
    const eloB = eloFor(pB, info.surface);
    if (eloA == null || eloB == null) { skipped++; continue; }

    // Set-level prob via eloProb, depois compor BO3/BO5
    const setProbA = eloProb(eloA, eloB);
    const matchProbA = info.bestOf === 5
      ? Math.pow(setProbA, 3) * (1 + 3 * (1 - setProbA) + 6 * Math.pow(1 - setProbA, 2))
      : Math.pow(setProbA, 2) * (3 - 2 * setProbA);
    const matchProbB = 1 - matchProbA;

    const evA = matchProbA * m.odd_a - 1;
    const evB = matchProbB * m.odd_b - 1;

    let pickPlayer: PlayerRow | null = null;
    let pickOpp: PlayerRow | null = null;
    let pickOdd = 0;
    let pickEv = 0;

    // Cap EV a 30%. Acima disso é quase sempre erro de modelo (ELO stale,
    // baixo set_count, veteranos com ELO histórico desactualizado). Twin é
    // eficiente — EV reais raramente passam de 15-20%.
    const MAX_EV = 0.30;
    if (evA >= 0.05 && evA <= MAX_EV && evA >= evB) {
      pickPlayer = pA; pickOpp = pB; pickOdd = m.odd_a; pickEv = evA;
    } else if (evB >= 0.05 && evB <= MAX_EV) {
      pickPlayer = pB; pickOpp = pA; pickOdd = m.odd_b; pickEv = evB;
    } else {
      skipped++; continue;
    }

    // Dedup: já temos pick para este match (player+player) HOJE?
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await supabase
      .from('picks')
      .select('id')
      .eq('p1_name', pickPlayer.name)
      .eq('p2_name', pickOpp.name)
      .gte('posted_at', `${today}T00:00:00Z`)
      .limit(1);
    if (existing && existing.length > 0) { skipped++; continue; }

    const evPct = Math.round(pickEv * 10000) / 100;
    const row = {
      player_id: pickPlayer.id,
      market: m.tour === 'wta' ? 'Vencedora' : 'Vencedor',
      selection: pickPlayer.name,
      odd: pickOdd,
      edge_pct: evPct,
      grade: getGrade(evPct),
      stake: 10,
      source: 'twin',
      p1_name: pickPlayer.name,
      p2_name: pickOpp.name,
      p1_flag: pickPlayer.flag ?? null,
      p2_flag: pickOpp.flag ?? null,
      tournament_name: info.name,
      surface: info.surface,
      scheduled_at: parseKickoff(m.kickoff_date_text, m.kickoff_time_text),
    };
    const { error } = await supabase.from('picks').insert(row);
    if (!error) inserted++;
    else skipped++;
  }

  // ── Doubles pipeline ─────────────────────────────────────────────────
  let doublesInserted = 0;
  let doublesSkipped = 0;
  for (const dm of doublesMatches) {
    const res = await processDoubles(dm, idx);
    if (res === 'inserted') doublesInserted++;
    else doublesSkipped++;
  }

  return NextResponse.json({
    ok: true,
    received: matches.length,
    resolved,
    inserted,
    skipped,
    doubles_received: doublesMatches.length,
    doubles_inserted: doublesInserted,
    doubles_skipped: doublesSkipped,
    debug_samples: debugSamples,
    index_debug: indexDebug,
  });
}

export async function GET(req: NextRequest) { return POST(req); }
