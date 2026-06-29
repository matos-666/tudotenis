/**
 * Sportradar player → our players.id resolver.
 *
 * Sportradar identifies players by sr_team_id (e.g. 16856930 for
 * "Zheng, Michael"). We cache the mapping in sr_player_map to keep
 * the live cron fast.
 *
 * Match heuristics (in order):
 *   1. Cache hit on sr_team_id
 *   2. Exact normalized name match (NFKD strip accents, lowercase)
 *   3. Last-name + first-letter match (Sackmann convention)
 *
 * On miss, returns null and DOES NOT auto-create (the players table
 * is large; manual review is safer).
 */
import { getServiceSupabase } from './supabase';

const supabase = getServiceSupabase();

export interface SrPlayer {
  sr_team_id: number;
  name: string; // "Last, First" Sportradar convention
}

interface MapRow {
  sr_team_id: number;
  player_id: number | null;
}

function strip(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function srToLastFirst(srName: string): { last: string; first: string } {
  const parts = srName.split(',').map(s => s.trim());
  return { last: parts[0] ?? '', first: parts[1] ?? '' };
}

/**
 * Resolve up to N Sportradar players in one DB roundtrip.
 * Returns map sr_team_id → players.id (or null if not matched).
 */
export async function resolveSrPlayers(
  players: SrPlayer[],
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  if (players.length === 0) return out;

  // 1. Cache hit
  const ids = players.map(p => p.sr_team_id);
  const { data: cached } = await supabase
    .from('sr_player_map')
    .select('sr_team_id, player_id')
    .in('sr_team_id', ids);
  const cacheMap = new Map<number, number | null>();
  for (const r of (cached ?? []) as MapRow[]) {
    cacheMap.set(Number(r.sr_team_id), r.player_id ? Number(r.player_id) : null);
  }
  for (const id of ids) {
    if (cacheMap.has(id)) out.set(id, cacheMap.get(id)!);
  }

  const unresolved = players.filter(p => !out.has(p.sr_team_id));
  if (unresolved.length === 0) return out;

  // 2-3. Fuzzy match for the unresolved
  const lastNames = [...new Set(unresolved.map(p => strip(srToLastFirst(p.name).last)))].filter(Boolean);
  if (lastNames.length === 0) {
    for (const p of unresolved) out.set(p.sr_team_id, null);
    return out;
  }

  // Pull a candidate set: any player whose name contains any of the last names.
  // We compare client-side because Postgres lacks NFKD normalize.
  // Limit pull to keep egress sane.
  const orFilter = lastNames.map(ln => `name.ilike.%${ln}%`).join(',');
  const { data: cands } = await supabase
    .from('players')
    .select('id, name, slug')
    .or(orFilter)
    .limit(500);
  const candidates: Array<{ id: number; name: string; slug: string; norm: string }> = (cands ?? []).map(c => ({
    id: Number(c.id),
    name: c.name as string,
    slug: c.slug as string,
    norm: strip(c.name as string),
  }));

  const toInsert: Array<{
    sr_team_id: number; player_id: number | null;
    sr_name: string; matched_name: string | null;
    match_confidence: number; match_method: string;
  }> = [];

  for (const p of unresolved) {
    const { last, first } = srToLastFirst(p.name);
    const normFull = strip(`${first} ${last}`);
    const normRev = strip(`${last} ${first}`);
    const normLast = strip(last);
    const firstInitial = (first[0] ?? '').toLowerCase();

    // Exact-match either direction
    let hit = candidates.find(c => c.norm === normFull || c.norm === normRev);
    let method = 'exact';
    let conf = 1.0;

    if (!hit && firstInitial) {
      // Last-name + first-initial match (handles "Auger-Aliassime, Felix" → "felix auger aliassime")
      const lastMatches = candidates.filter(c => c.norm.endsWith(normLast));
      const withFirst = lastMatches.find(c => c.norm.startsWith(firstInitial));
      if (withFirst) {
        hit = withFirst;
        method = 'last+initial';
        conf = 0.85;
      } else if (lastMatches.length === 1) {
        hit = lastMatches[0];
        method = 'last-unique';
        conf = 0.70;
      }
    }

    out.set(p.sr_team_id, hit?.id ?? null);
    toInsert.push({
      sr_team_id: p.sr_team_id,
      player_id: hit?.id ?? null,
      sr_name: p.name,
      matched_name: hit?.name ?? null,
      match_confidence: hit ? conf : 0,
      match_method: hit ? method : 'no-match',
    });
  }

  if (toInsert.length > 0) {
    await supabase.from('sr_player_map').upsert(toInsert, { onConflict: 'sr_team_id' });
  }

  return out;
}
