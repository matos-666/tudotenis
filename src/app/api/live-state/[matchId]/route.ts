/**
 * Endpoint público para polling client-side do MatchTracker.
 * Devolve a última snapshot de live_state para o match.
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await ctx.params;
  const id = Number(matchId);
  if (!Number.isFinite(id)) return NextResponse.json(null);
  const { data } = await supabase
    .from('live_state')
    .select('sr_match_id, set_a, set_b, game_a, game_b, point_a, point_b, server, tiebreak, aces_a, aces_b, df_a, df_b, bp_won_a, bp_won_b, bp_total_a, bp_total_b, serve_pts_won_a, serve_pts_won_b, match_win_prob_a, captured_at, match_finished, final_winner')
    .eq('sr_match_id', id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json(data ?? null, {
    headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10' },
  });
}
