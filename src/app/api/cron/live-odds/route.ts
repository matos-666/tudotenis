/**
 * Cron: ingest de live odds para os matches em curso.
 *
 * Status: SCAFFOLD. A integração com a casa (1xBet GetGameZip / OddsAPI
 * live / Pinnacle public) fica como TODO — depende de discovery dos
 * endpoints de tenis específicos.
 *
 * O que este endpoint vai fazer (quando ligado):
 *   1. Ler lista de sr_match_id que estão `running:true` em live_state_latest
 *   2. Para cada um, tentar match contra a lista de matches live no sportsbook
 *      (matching por player names normalized — implementar fuzzy similar
 *      ao sr-player-match.ts)
 *   3. Pull odd_a / odd_b / over_games / under_games / line_games do source
 *   4. Insert em live_odds_history (uma linha por (match, source, timestamp))
 *   5. Update em live_picks abertos deste match: preencher live_odd_a/b,
 *      edge_pct = model_prob × live_odd - 1 (só se snapshot < 60s old)
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

interface LiveMatchRef {
  sr_match_id: number;
  name_a: string | null;
  name_b: string | null;
  match_win_prob_a: number | null;
  captured_at: string;
}

async function fetchRunningMatches(): Promise<LiveMatchRef[]> {
  const { data } = await supabase
    .from('live_state_latest')
    .select('sr_match_id, name_a, name_b, match_win_prob_a, captured_at')
    .eq('running', true)
    .limit(40);
  return (data ?? []) as LiveMatchRef[];
}

/**
 * Stub: substituir por chamada real à API da casa.
 * Esperado: dado um par de nomes, devolve odds live no formato standard.
 */
async function fetchOddsForMatch(_nameA: string, _nameB: string): Promise<{
  source: string;
  odd_a: number | null;
  odd_b: number | null;
  odd_over_games: number | null;
  odd_under_games: number | null;
  line_games: number | null;
  raw_payload: unknown;
} | null> {
  // TODO: implementar adapter para 1xBet betlbl tennis endpoint ou OddsAPI live.
  // Por agora retorna null → endpoint funciona como no-op até source estar
  // configurado.
  return null;
}

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
    const edgePct = +(modelProb * odd - 1).toFixed(4) * 100;
    const { error } = await supabase
      .from('live_picks')
      .update({ live_odd: odd, edge_pct: +edgePct.toFixed(2) })
      .eq('id', pick.id);
    if (!error) updated++;
  }
  return updated;
}

async function pollOddsOnce(): Promise<{ checked: number; captured: number; picks_updated: number }> {
  let checked = 0, captured = 0, picks_updated = 0;
  const matches = await fetchRunningMatches();

  for (const m of matches) {
    checked++;
    if (!m.name_a || !m.name_b) continue;
    const odds = await fetchOddsForMatch(m.name_a, m.name_b);
    if (!odds) continue;

    const { error } = await supabase.from('live_odds_history').insert({
      sr_match_id: m.sr_match_id,
      source: odds.source,
      odd_a: odds.odd_a,
      odd_b: odds.odd_b,
      odd_over_games: odds.odd_over_games,
      odd_under_games: odds.odd_under_games,
      line_games: odds.line_games,
      raw_payload: odds.raw_payload,
    });
    if (error) continue;
    captured++;

    picks_updated += await attachOddsToOpenPicks(m.sr_match_id, odds.odd_a, odds.odd_b);
  }

  return { checked, captured, picks_updated };
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
