/**
 * POST/GET /api/cron/elo-snapshot
 *
 * Cron semanal: tira um snapshot dos ratings ELO actuais de todos os
 * jogadores activos com sample size suficiente, e faz upsert em
 * elo_history para a data de hoje.
 *
 * Sem isto, o histórico fica congelado no último snapshot feito pelo
 * import_full.py (que requer correr manualmente). Este cron garante que
 * a tabela elo_history vai recebendo pontos novos automaticamente.
 *
 * Schedule: vercel.json — "0 4 * * 1" (segundas 04:00 UTC).
 *
 * Idempotente: usa upsert por (player_id, date). Correr múltiplas vezes
 * no mesmo dia sobrepõe os valores; usa SEMPRE os mais recentes do
 * players.elo_*.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PlayerSnap {
  id: number;
  elo_overall: number | null;
  elo_hard: number | null;
  elo_clay: number | null;
  elo_grass: number | null;
  elo_indoor: number | null;
  // Phase C — set-level (fonte de verdade actual)
  elo_set_overall: number | null;
  elo_set_hard: number | null;
  elo_set_clay: number | null;
  elo_set_grass: number | null;
}

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET ?? process.env.REVALIDATE_SECRET ?? '';
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sb = getServiceSupabase();

  // Só snapshots de players com sample relevante.
  const { data, error } = await sb
    .from('players')
    .select(
      'id, elo_overall, elo_hard, elo_clay, elo_grass, elo_indoor, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass',
    )
    .eq('active', true)
    .gte('set_count', 100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const players = (data ?? []) as PlayerSnap[];

  const today = new Date().toISOString().slice(0, 10);

  const rows = players
    .filter(p => p.elo_overall != null || p.elo_set_overall != null)
    .map(p => ({
      player_id: p.id,
      date: today,
      elo_overall: p.elo_overall,
      elo_hard: p.elo_hard,
      elo_clay: p.elo_clay,
      elo_grass: p.elo_grass,
      elo_indoor: p.elo_indoor,
      // Phase C — set-level (frescos)
      elo_set_overall: p.elo_set_overall,
      elo_set_hard: p.elo_set_hard,
      elo_set_clay: p.elo_set_clay,
      elo_set_grass: p.elo_set_grass,
    }));

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, snapshotted: 0, date: today });
  }

  // Upsert em batches de 500 para não rebentar limites do PostgREST.
  let written = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error: upErr } = await sb
      .from('elo_history')
      .upsert(slice, { onConflict: 'player_id,date' });
    if (upErr) {
      return NextResponse.json(
        { error: upErr.message, written, total: rows.length },
        { status: 500 },
      );
    }
    written += slice.length;
  }

  return NextResponse.json({
    ok: true,
    snapshotted: written,
    date: today,
  });
}

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}
