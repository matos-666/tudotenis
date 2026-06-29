/**
 * Ingest endpoint para odds scraped via Playwright (GHA → Vercel).
 *
 * Payload (JSON):
 *   {
 *     source: 'twin' | 'betlabel' | ...,
 *     captured_at: ISO timestamp,
 *     matches: [{ name_a, name_b, odd_a, odd_b }, ...]
 *   }
 *
 * Fluxo:
 *   1. Auth via CRON_SECRET
 *   2. Para cada match: fuzzy match contra live_state_latest por nomes
 *   3. Insert em live_odds_history (uma linha por match × source × ts)
 *   4. attachOddsToOpenPicks: edge_pct = (model_prob × live_odd - 1)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

const supabase = getServiceSupabase();

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

interface IngestPayload {
  source: string;
  captured_at?: string;
  matches?: Array<{
    name_a: string | null;
    name_b: string | null;
    odd_a: number | null;
    odd_b: number | null;
  }>;
}

interface LiveStateRow {
  sr_match_id: number;
  name_a: string | null;
  name_b: string | null;
}

function strip(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function lastNameToken(s: string): string {
  // Sportradar uses "Last, First" — extract just the "Last" part.
  // Twin/scrape returns "First Last" — extract last word.
  const trimmed = s.trim();
  if (trimmed.includes(',')) return strip(trimmed.split(',')[0]);
  const tokens = trimmed.split(/\s+/);
  return strip(tokens[tokens.length - 1] ?? '');
}

async function attachOddsToOpenPicks(
  srMatchId: number,
  oddA: number | null,
  oddB: number | null,
  source: string,
): Promise<number> {
  const { data: openPicks } = await supabase
    .from('live_picks')
    .select('id, selection, model_prob')
    .eq('sr_match_id', srMatchId)
    .is('result', null);

  let updated = 0;
  for (const pick of openPicks ?? []) {
    const sel = pick.selection as 'A' | 'B' | string;
    const odd = sel === 'A' ? oddA : sel === 'B' ? oddB : null;
    if (odd == null) continue;
    const modelProb = Number(pick.model_prob);
    const edgePct = +((modelProb * odd - 1) * 100).toFixed(2);
    const { error } = await supabase
      .from('live_picks')
      .update({ live_odd: odd, live_odd_source: source, edge_pct: edgePct })
      .eq('id', pick.id);
    if (!error) updated++;
  }
  return updated;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: IngestPayload;
  try {
    payload = (await req.json()) as IngestPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const source = payload.source ?? 'unknown';
  const scraped = (payload.matches ?? []).filter(m => m.name_a && m.name_b && (m.odd_a != null || m.odd_b != null));
  if (scraped.length === 0) {
    return NextResponse.json({ ok: true, received: 0, matched: 0, inserted: 0, picks_updated: 0 });
  }

  // Pull running matches do Sportradar
  const { data: srRows } = await supabase
    .from('live_state_latest')
    .select('sr_match_id, name_a, name_b')
    .eq('running', true)
    .limit(80);
  const srMatches = (srRows ?? []) as LiveStateRow[];

  let matched = 0, inserted = 0, picksUpdated = 0;
  for (const s of scraped) {
    if (!s.name_a || !s.name_b) continue;
    const aLast = lastNameToken(s.name_a);
    const bLast = lastNameToken(s.name_b);

    let hit: LiveStateRow | null = null;
    let flipped = false;
    for (const sr of srMatches) {
      if (!sr.name_a || !sr.name_b) continue;
      const srALast = lastNameToken(sr.name_a);
      const srBLast = lastNameToken(sr.name_b);
      if (aLast === srALast && bLast === srBLast) { hit = sr; flipped = false; break; }
      if (aLast === srBLast && bLast === srALast) { hit = sr; flipped = true; break; }
    }

    if (!hit) continue;
    matched++;

    const oddA_sr = flipped ? s.odd_b : s.odd_a;
    const oddB_sr = flipped ? s.odd_a : s.odd_b;

    const { error } = await supabase.from('live_odds_history').insert({
      sr_match_id: hit.sr_match_id,
      source,
      odd_a: oddA_sr,
      odd_b: oddB_sr,
      raw_payload: { scraped_name_a: s.name_a, scraped_name_b: s.name_b, flipped },
    });
    if (!error) inserted++;

    picksUpdated += await attachOddsToOpenPicks(hit.sr_match_id, oddA_sr, oddB_sr, source);
  }

  return NextResponse.json({
    ok: true,
    received: scraped.length,
    matched,
    inserted,
    picks_updated: picksUpdated,
  });
}
