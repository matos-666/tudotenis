/**
 * POST /api/cron/settle
 * Cron diário: settle picks pendentes consultando resultados em TennisStats
 *
 * Fluxo:
 *   1. Lê picks com result=NULL e posted_at >= ontem
 *   2. Scrape TennisStats para resultados de hoje + ontem
 *   3. Match por player names → determina win/loss/void
 *   4. UPDATE picks com result, pl, settled_at
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

const TENNISSTATS_URL = 'https://tennisstats.com/';

interface FinishedMatch {
  p1Name: string;
  p2Name: string;
  p1Sets: number;
  p2Sets: number;
  status: string; // Fin., Ret., Walko., W.O., Canc.
}

interface PickRow {
  id: number;
  selection: string;
  p1_name: string | null;
  p2_name: string | null;
  odd: number;
  stake: number;
  market: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET ?? process.env.REVALIDATE_SECRET ?? '';
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

// ── Scraping ──────────────────────────────────────────────────────────────
async function fetchFinishedMatches(): Promise<FinishedMatch[]> {
  const res = await fetch(TENNISSTATS_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`TennisStats HTTP ${res.status}`);
  return parseFinished(await res.text());
}

function parseFinished(html: string): FinishedMatch[] {
  const out: FinishedMatch[] = [];
  const blocks = html.split("<div class='match-list row cf");

  for (const block of blocks.slice(1)) {
    if (block.includes('format-doubles')) continue;
    if (block.includes('dnone-important')) continue;

    const matchRE = /<div class='match-row row cf \w+' ><a href='\/h2h\/[^']+'[^>]*>([\s\S]*?)<\/a><\/div>/g;
    let mm: RegExpExecArray | null;

    while ((mm = matchRE.exec(block)) !== null) {
      const inner = mm[1];

      // Player 1: padding:7px row → name + sets
      // Player 2: padding:3.5px row → name + sets
      const rowRE = /padding:[37][^;]+;[\s\S]*?box2 bbox'>([^<]+)<[\s\S]*?set-box ac'><p[^>]*>([^<]+)<\/p>/g;
      const rows: [string, string][] = [];
      let rm: RegExpExecArray | null;
      while ((rm = rowRE.exec(inner)) !== null) {
        rows.push([rm[1], rm[2]]);
      }
      if (rows.length < 2) continue;

      const statusM = inner.match(/live-box ac'><p[^>]*>([^<]+)<\/p>/);
      const status = statusM ? statusM[1].trim() : '';

      // Only consider terminal states
      if (!['Fin.', 'Ret.', 'Walko.', 'W.O.', 'Canc.'].includes(status)) continue;

      const p1Name = rows[0][0].replace(/\s*\(\d+\)\s*$/, '').replace(/<[^>]+>/g, '').trim();
      const p2Name = rows[1][0].replace(/\s*\(\d+\)\s*$/, '').replace(/<[^>]+>/g, '').trim();

      const p1Sets = parseInt(rows[0][1].trim()) || 0;
      const p2Sets = parseInt(rows[1][1].trim()) || 0;

      out.push({ p1Name, p2Name, p1Sets, p2Sets, status });
    }
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function nameMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b);
}

function calculatePL(result: 'win' | 'loss' | 'void', odd: number, stake: number): number {
  if (result === 'win') return Math.round((stake * (odd - 1)) * 100) / 100;
  if (result === 'loss') return -stake;
  return 0;
}

function findResult(pick: PickRow, finished: FinishedMatch[]): {
  result: 'win' | 'loss' | 'void';
  match: FinishedMatch;
} | null {
  for (const m of finished) {
    const p1 = pick.p1_name ?? pick.selection;
    const p2 = pick.p2_name ?? '';

    const matchA = nameMatch(p1, m.p1Name) && nameMatch(p2, m.p2Name);
    const matchB = nameMatch(p1, m.p2Name) && nameMatch(p2, m.p1Name);
    if (!matchA && !matchB) continue;

    // Void cases
    if (m.status === 'Canc.' || m.status === 'Walko.' || m.status === 'W.O.') {
      return { result: 'void', match: m };
    }

    // Determine winner (player with more sets won)
    const pickIsP1 = nameMatch(p1, m.p1Name);
    const pickPlayerSets = pickIsP1 ? m.p1Sets : m.p2Sets;
    const oppPlayerSets  = pickIsP1 ? m.p2Sets : m.p1Sets;

    // Ret. → player who quit loses (the one with fewer sets typically)
    // Simple heuristic: pickPlayerSets > oppPlayerSets → win
    if (m.status === 'Ret.') {
      // if pickPlayer has more sets, presumably opponent retired → win
      if (pickPlayerSets > oppPlayerSets) return { result: 'win', match: m };
      if (pickPlayerSets < oppPlayerSets) return { result: 'loss', match: m };
      // 0-0 retired → void
      return { result: 'void', match: m };
    }

    // Fin.: simple compare
    if (pickPlayerSets > oppPlayerSets) return { result: 'win', match: m };
    if (pickPlayerSets < oppPlayerSets) return { result: 'loss', match: m };
    return { result: 'void', match: m };
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supa = getServiceSupabase();
  const logs: string[] = [];
  let settled = 0;
  let pending = 0;

  try {
    // 1. Fetch unsettled picks from last 48h
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: picks, error } = await supa
      .from('picks')
      .select('id, selection, p1_name, p2_name, odd, stake, market')
      .is('result', null)
      .gte('posted_at', since);

    if (error) throw new Error(`Supabase: ${error.message}`);

    const pickList = (picks ?? []) as PickRow[];
    logs.push(`📋 ${pickList.length} pick(s) por settle`);

    if (pickList.length === 0) {
      return NextResponse.json({ ok: true, settled: 0, pending: 0, logs });
    }

    // 2. Scrape finished matches
    logs.push('📡 Scraping resultados…');
    const finished = await fetchFinishedMatches();
    logs.push(`   ${finished.length} jogos terminados encontrados`);

    // 3. Match results to picks
    for (const pick of pickList) {
      const r = findResult(pick, finished);
      if (!r) {
        pending++;
        continue;
      }

      const pl = calculatePL(r.result, pick.odd, pick.stake);

      const { error: updErr } = await supa
        .from('picks')
        .update({
          result: r.result,
          pl,
          settled_at: new Date().toISOString(),
        })
        .eq('id', pick.id);

      if (updErr) {
        logs.push(`  ❌ Erro ao settle pick ${pick.id}: ${updErr.message}`);
        continue;
      }

      settled++;
      const emoji = r.result === 'win' ? '✅' : r.result === 'loss' ? '❌' : '⊘';
      logs.push(
        `  ${emoji} ${pick.selection} (${r.match.p1Sets}-${r.match.p2Sets} ${r.match.status})  ` +
        `→ ${r.result.toUpperCase()}  P&L=€${pl.toFixed(2)}`
      );
    }

    // 4. Trigger revalidation of /picks page
    logs.push(`\n✅ ${settled} settled · ${pending} ainda pendentes`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`❌ Error: ${msg}`);
    return NextResponse.json({ ok: false, error: msg, logs }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settled, pending, logs });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
