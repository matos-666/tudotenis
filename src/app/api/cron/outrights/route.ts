/**
 * POST/GET /api/cron/outrights
 *
 * Cron diário: para cada torneio com oddschecker_url + status 'scheduled'
 * ou 'live' + end_date no futuro, raspa Oddschecker, faz match dos nomes
 * contra a tabela players e faz upsert em outright_odds.
 *
 * Chamado via:
 *   - Vercel Cron (vercel.json) — autenticado por CRON_SECRET header
 *   - workflow_dispatch manual
 *
 * Rate-limit interno: 4s entre fetches. Cada torneio é independente — falhas
 * (HTML diferente, Cloudflare block) não param os outros.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import {
  fetchOddscheckerHtml,
  parseOutrights,
  normalizeName,
  surname,
} from '@/lib/oddschecker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DELAY_MS = 4000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface TournamentRow {
  id: number;
  slug: string;
  name: string;
  tour: string;
  oddschecker_url: string;
  status: string | null;
  end_date: string | null;
}

interface PlayerRow {
  id: number;
  name: string;
  tour: string;
}

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET ?? process.env.REVALIDATE_SECRET ?? '';
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

// Build name-matching index for a tour's players.
function buildPlayerIndex(players: PlayerRow[]) {
  const byFull = new Map<string, PlayerRow>();
  const bySurname = new Map<string, PlayerRow[]>();
  for (const p of players) {
    byFull.set(normalizeName(p.name), p);
    const sn = surname(p.name);
    if (!bySurname.has(sn)) bySurname.set(sn, []);
    bySurname.get(sn)!.push(p);
  }
  return { byFull, bySurname };
}

function matchPlayer(
  raw: string,
  idx: ReturnType<typeof buildPlayerIndex>,
): PlayerRow | null {
  const norm = normalizeName(raw);
  // 1) Full name direct match
  const direct = idx.byFull.get(norm);
  if (direct) return direct;
  // 2) Surname-only (only if unique)
  const sn = surname(raw);
  const candidates = idx.bySurname.get(sn) ?? [];
  if (candidates.length === 1) return candidates[0];
  // 3) First initial + surname disambiguation
  if (candidates.length > 1) {
    const firstInitial = norm[0];
    const filtered = candidates.filter(c =>
      normalizeName(c.name).startsWith(firstInitial),
    );
    if (filtered.length === 1) return filtered[0];
  }
  return null;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sb = getServiceSupabase();

  const today = new Date().toISOString().slice(0, 10);

  const { data: tdata, error: terr } = await sb
    .from('tournaments')
    .select('id, slug, name, tour, oddschecker_url, status, end_date')
    .not('oddschecker_url', 'is', null)
    .in('status', ['scheduled', 'live'])
    .gte('end_date', today);

  if (terr) {
    return NextResponse.json({ error: terr.message }, { status: 500 });
  }
  const tournaments = (tdata ?? []) as TournamentRow[];

  if (tournaments.length === 0) {
    return NextResponse.json({
      ok: true,
      tournaments: 0,
      message: 'no eligible tournaments (need oddschecker_url + status scheduled/live)',
    });
  }

  // Pre-fetch players per tour (most cases tour={atp,wta}, slams têm ambos)
  const tourCache = new Map<string, ReturnType<typeof buildPlayerIndex>>();
  async function indexFor(tour: string) {
    const norm = tour.toLowerCase();
    if (tourCache.has(norm)) return tourCache.get(norm)!;
    const { data } = await sb
      .from('players')
      .select('id, name, tour')
      .eq('tour', norm);
    const idx = buildPlayerIndex((data ?? []) as PlayerRow[]);
    tourCache.set(norm, idx);
    return idx;
  }

  const results: Array<Record<string, unknown>> = [];

  for (let i = 0; i < tournaments.length; i++) {
    const t = tournaments[i];
    try {
      const html = await fetchOddscheckerHtml(t.oddschecker_url);
      const rows = parseOutrights(html);

      if (rows.length === 0) {
        results.push({
          tournament: t.slug,
          status: 'no_rows',
          html_size: html.length,
        });
        continue;
      }

      const tourForMatch = (t.tour === 'both' ? 'atp' : t.tour).toLowerCase();
      const idx = await indexFor(tourForMatch);

      const payload: Array<Record<string, unknown>> = [];
      const unmatched: string[] = [];
      const fetchedAt = new Date().toISOString();

      for (const r of rows) {
        const p = matchPlayer(r.rawName, idx);
        const implied = Math.min(0.999, Math.max(0.001, 1 / r.bestDecimal));
        payload.push({
          tournament_id: t.id,
          player_id: p?.id ?? null,
          raw_name: r.rawName,
          best_decimal: r.bestDecimal,
          best_bookies: r.bestBookies || null,
          implied_prob: Number(implied.toFixed(4)),
          fetched_at: fetchedAt,
        });
        if (!p) unmatched.push(r.rawName);
      }

      const { error: upErr } = await sb
        .from('outright_odds')
        .upsert(payload, { onConflict: 'tournament_id,raw_name' });

      if (upErr) {
        results.push({ tournament: t.slug, status: 'db_error', error: upErr.message });
      } else {
        results.push({
          tournament: t.slug,
          status: 'ok',
          scraped: rows.length,
          matched: rows.length - unmatched.length,
          unmatched: unmatched.length,
          unmatched_sample: unmatched.slice(0, 5),
        });
      }
    } catch (err) {
      results.push({
        tournament: t.slug,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Pause between fetches — exceto no último
    if (i < tournaments.length - 1) await sleep(DELAY_MS);
  }

  return NextResponse.json({
    ok: true,
    tournaments: tournaments.length,
    results,
  });
}

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}
