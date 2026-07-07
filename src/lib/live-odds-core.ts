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
import { getServiceSupabase } from '@/lib/supabase';

const supabase = getServiceSupabase();

export interface IngestPayload {
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

// Caps de viabilidade duma pick após termos a odd live:
// - ODD_MIN: odds abaixo de 1.25 têm prémio insuficiente para
//   compensar o risco/variância. Strike rate cosmético.
// - ODD_MAX: odds acima de 4.0 são longshots — o modelo a propor
//   um @15 com edge gigante é quase sempre overconfidence
//   (calibração fraca em cauda).
// - EDGE_MAX_PCT: edge teórico acima de 100% ≈ modelo discorda do
//   mercado em factor 2x — sinal típico de erro de modelo, não de
//   valor. Mercado é regularizador implícito.
const ODD_MIN = 1.25;
const ODD_MAX = 4.0;
const EDGE_MAX_PCT = 100;

async function attachOddsToOpenPicks(
  srMatchId: number,
  oddA: number | null,
  oddB: number | null,
  source: string,
): Promise<number> {
  // IMPORTANTE: só atribuímos odd a picks que AINDA NÃO TÊM odd
  // (live_odd IS NULL). Uma pick emitida com odd válida é uma decisão
  // "commited" — o mercado pode mexer depois mas o histórico deve
  // reflectir o que decidimos naquele momento. Se re-processarmos, o
  // edge_pct passa a ser calculado com odd nova e as caps podem apagar
  // picks legítimas por movimento de mercado. Neste momento, com o
  // maybeEmitPick a exigir odd fresh à emissão, este código só cobre
  // uma race rara: pick emitida quando a odd tinha desaparecido dos
  // últimos 5 min e voltou depois.
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

    // Caps aplicam-se APENAS ao attach inicial (never had odd). Se cair
    // fora aqui, o pick nunca foi apostável e é apagado.
    if (odd < ODD_MIN || odd > ODD_MAX || edgePct > EDGE_MAX_PCT) {
      await supabase.from('live_picks').delete().eq('id', pick.id);
      continue;
    }

    const { error } = await supabase
      .from('live_picks')
      .update({ live_odd: odd, live_odd_source: source, edge_pct: edgePct })
      .eq('id', pick.id);
    if (!error) updated++;
  }
  return updated;
}

export async function ingestTwinOdds(payload: IngestPayload): Promise<{
  received: number; matched: number; inserted: number; picks_updated: number;
}> {
  const source = payload.source ?? 'unknown';
  const scraped = (payload.matches ?? []).filter(m => m.name_a && m.name_b && (m.odd_a != null || m.odd_b != null));
  if (scraped.length === 0) {
    return { received: 0, matched: 0, inserted: 0, picks_updated: 0 };
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

  return {
    received: scraped.length,
    matched,
    inserted,
    picks_updated: picksUpdated,
  };
}
