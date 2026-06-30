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

interface IngestMatch {
  tour: 'atp' | 'wta';
  tournament: string | null;
  name_a: string;
  name_b: string;
  odd_a: number;
  odd_b: number;
  kickoff_date_text: string | null;
  kickoff_time_text: string | null;
  twin_href: string | null;
}

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
  elo_set_indoor: number | null;
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

async function buildPlayerIndex(): Promise<PlayerIndex> {
  const out: PlayerIndex = { byTour: new Map() };
  let offset = 0;
  const page = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  while (true) {
    const { data } = await supabase
      .from('players')
      .select('id, name, slug, flag, tour, elo_overall, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass, elo_set_indoor')
      .eq('active', true)
      .range(offset, offset + page - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < page) break;
    offset += page;
  }
  for (const p of all as PlayerRow[]) {
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
  const key = `elo_set_${surface}` as const;
  return p[key] ?? p.elo_set_overall ?? p.elo_overall ?? null;
}

function getGrade(edge: number): 'A' | 'B' | 'C' {
  if (edge >= 12) return 'A';
  if (edge >= 8) return 'B';
  return 'C';
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

  const matches = (payload.matches ?? []).filter(m => m.name_a && m.name_b && m.odd_a > 1 && m.odd_b > 1);
  if (matches.length === 0) {
    return NextResponse.json({ ok: true, received: 0, resolved: 0, inserted: 0 });
  }

  const idx = await buildPlayerIndex();
  let resolved = 0, inserted = 0, skipped = 0;
  const debugSamples: Array<{ name_a: string; name_b: string; pA: string | null; pB: string | null }> = [];

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

    if (evA >= 0.05 && evA >= evB) {
      pickPlayer = pA; pickOpp = pB; pickOdd = m.odd_a; pickEv = evA;
    } else if (evB >= 0.05) {
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

  return NextResponse.json({
    ok: true,
    received: matches.length,
    resolved,
    inserted,
    skipped,
    debug_samples: debugSamples,
  });
}

export async function GET(req: NextRequest) { return POST(req); }
