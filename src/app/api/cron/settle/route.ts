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
  surface: string | null;
  tournament_name: string | null;
  tennisstats_slug: string | null;
  elo_applied: boolean | null;
}

// ── Auth ──────────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET ?? process.env.REVALIDATE_SECRET ?? '';
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

// ── Scraping ──────────────────────────────────────────────────────────────
async function fetchTennisStatsHtml(): Promise<string> {
  const res = await fetch(TENNISSTATS_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`TennisStats HTTP ${res.status}`);
  return res.text();
}

async function fetchFinishedMatches(): Promise<FinishedMatch[]> {
  return parseFinished(await fetchTennisStatsHtml());
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

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
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

  const jobTag = req.nextUrl.searchParams.get('source') === 'manual' ? 'manual_settle' : 'settle';
  const { startCronLog, finishCronLog } = await import('@/lib/cron-log');
  const logId = await startCronLog(jobTag);

  const supa = getServiceSupabase();
  const logs: string[] = [];
  let settled = 0;
  let pending = 0;

  try {
    // 1. Fetch unsettled picks from last 48h
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: picks, error } = await supa
      .from('picks')
      .select('id, selection, p1_name, p2_name, odd, stake, market, surface, tournament_name, tennisstats_slug, elo_applied')
      .is('result', null)
      .gte('posted_at', since);

    if (error) throw new Error(`Supabase: ${error.message}`);

    const pickList = (picks ?? []) as PickRow[];
    logs.push(`📋 ${pickList.length} pick(s) por settle`);

    if (pickList.length === 0) {
      await finishCronLog(logId, true, 'no pending picks', { settled: 0, pending: 0, logs });
      return NextResponse.json({ ok: true, settled: 0, pending: 0, logs });
    }

    // 2. Scrape page (uma vez para ambos singles + doubles)
    logs.push('📡 Scraping resultados…');
    const html = await fetchTennisStatsHtml();
    const finished = parseFinished(html);
    logs.push(`   ${finished.length} jogos singles terminados`);

    // ── Imports lazy do singles-elo updater ─────────────────────────────
    const { applySinglesEloUpdate } = await import('@/lib/singles-elo');

    // Track quais slugs já tiveram ELO aplicado neste run + slugs já
    // aplicados em runs anteriores (para dedup quando 2 picks no mesmo match)
    const appliedSlugs = new Set<string>(
      pickList.filter(p => p.elo_applied && p.tennisstats_slug).map(p => p.tennisstats_slug!)
    );
    let eloApplied = 0;
    let eloSkipped = 0;
    let eloErrors = 0;

    // 3. Match results to picks (singles)
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

      // ── Aplica delta-ELO singles incremental ─────────────────────────
      // Skip para voids (sem informação útil), sem oponente conhecido,
      // ou para slugs já processados.
      if (r.result === 'void' || !pick.p1_name || !pick.p2_name) continue;
      const slug = pick.tennisstats_slug;
      if (slug && appliedSlugs.has(slug)) { eloSkipped++; continue; }

      // selection é o player escolhido; o oponente é o outro nome
      const selIsP1 = pick.selection.trim() === (pick.p1_name?.trim() ?? '');
      const oppName = selIsP1 ? pick.p2_name : pick.p1_name;
      const eloRes = await applySinglesEloUpdate(supa, {
        selectionName: pick.selection,
        oppName: oppName ?? '',
        selectionWon: r.result === 'win',
        // Map sets do scrape (p1Sets/p2Sets em referência ao scrape p1/p2)
        // para selection/opp. r.match.p1Name pode estar invertido vs pick.
        setsWonBySelection: pick.selection.trim().toLowerCase() === r.match.p1Name.trim().toLowerCase()
          ? r.match.p1Sets
          : r.match.p2Sets,
        setsWonByOpp: pick.selection.trim().toLowerCase() === r.match.p1Name.trim().toLowerCase()
          ? r.match.p2Sets
          : r.match.p1Sets,
        surface: pick.surface,
        tournamentName: pick.tournament_name,
      });

      if (eloRes.ok) {
        eloApplied++;
        if (slug) appliedSlugs.add(slug);
        // Marca todos os picks com este slug como elo_applied
        if (slug) {
          await supa
            .from('picks')
            .update({ elo_applied: true })
            .eq('tennisstats_slug', slug);
        } else {
          await supa.from('picks').update({ elo_applied: true }).eq('id', pick.id);
        }
      } else {
        eloErrors++;
        logs.push(`    ⚠ ELO update falhou: ${eloRes.error}`);
      }
    }
    if (eloApplied || eloErrors || eloSkipped) {
      logs.push(`   📈 singles ELO: ${eloApplied} applied · ${eloSkipped} dup-skip · ${eloErrors} errors`);
    }

    // 4. Settle DOUBLES (matches sem winner em doubles_matches)
    let doublesSettled = 0;
    let doublesEloFailed = 0;
    try {
      const { parseDoublesFinished } = await import('@/lib/doubles-scrape');
      const { applyDoublesEloUpdate } = await import('@/lib/doubles-elo');
      const doublesFinished = parseDoublesFinished(html);
      logs.push(`   ${doublesFinished.length} jogos duplas terminados`);

      // Buscar duplas pendentes (sem winner) das últimas 72h
      const dblSince = new Date(Date.now() - 72 * 3600e3).toISOString();
      const { data: pendingDbl } = await supa
        .from('doubles_matches')
        .select('id, t1_p1_name, t1_p2_name, t2_p1_name, t2_p2_name, surface')
        .is('winner_team', null)
        .gte('created_at', dblSince);

      const dblList = pendingDbl ?? [];
      logs.push(`   ${dblList.length} jogos duplas por settle`);

      const norm = (s: string) =>
        s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

      for (const dm of dblList) {
        // Find a finished match com mesmas 4 partes (em qualquer ordem dentro de cada equipa)
        const t1Set = new Set([norm(dm.t1_p1_name ?? ''), norm(dm.t1_p2_name ?? '')]);
        const t2Set = new Set([norm(dm.t2_p1_name ?? ''), norm(dm.t2_p2_name ?? '')]);

        const found = doublesFinished.find(f => {
          const fT1 = new Set([norm(f.t1p1Name), norm(f.t1p2Name)]);
          const fT2 = new Set([norm(f.t2p1Name), norm(f.t2p2Name)]);
          const aMatch = setsEqual(t1Set, fT1) && setsEqual(t2Set, fT2);
          const bMatch = setsEqual(t1Set, fT2) && setsEqual(t2Set, fT1);
          return aMatch || bMatch;
        });
        if (!found) continue;

        const dmT1IsScrapeT1 = setsEqual(t1Set, new Set([norm(found.t1p1Name), norm(found.t1p2Name)]));
        const scrapeWinnerIs1 = found.t1Sets > found.t2Sets;
        // Map scrape winner to our team1/team2
        let winnerTeam: 1 | 2 | null = null;
        if (['Canc.', 'Walko.', 'W.O.'].includes(found.status)) {
          winnerTeam = null; // void
        } else if (scrapeWinnerIs1) {
          winnerTeam = dmT1IsScrapeT1 ? 1 : 2;
        } else if (found.t2Sets > found.t1Sets) {
          winnerTeam = dmT1IsScrapeT1 ? 2 : 1;
        }

        const score = `${found.t1Sets}-${found.t2Sets}`;
        const { error: updErr } = await supa
          .from('doubles_matches')
          .update({
            winner_team: winnerTeam,
            score,
            status: found.status,
            settled_at: new Date().toISOString(),
          })
          .eq('id', dm.id);

        if (updErr) {
          logs.push(`  ❌ duplas update ${dm.id}: ${updErr.message}`);
          continue;
        }

        doublesSettled++;
        if (winnerTeam != null) {
          const eloRes = await applyDoublesEloUpdate(supa, dm.id);
          if (!eloRes.ok) {
            doublesEloFailed++;
            logs.push(`  ⚠ duplas ELO update ${dm.id}: ${eloRes.error}`);
          }
        }
        logs.push(`  ✅ duplas ${dm.t1_p1_name}/${dm.t1_p2_name} vs ${dm.t2_p1_name}/${dm.t2_p2_name} ${score} → team${winnerTeam ?? 'void'}`);
      }
    } catch (e) {
      logs.push(`  ⚠ duplas settle: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 5. Trigger revalidation of /picks page
    logs.push(`\n✅ singles=${settled}/${pending+settled}  duplas=${doublesSettled}${doublesEloFailed ? ` (${doublesEloFailed} elo errors)` : ''}`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`❌ Error: ${msg}`);
    await finishCronLog(logId, false, msg, { settled, pending, logs });
    return NextResponse.json({ ok: false, error: msg, logs }, { status: 500 });
  }

  await finishCronLog(logId, true, `settled=${settled} pending=${pending}`, { settled, pending, logs });
  return NextResponse.json({ ok: true, settled, pending, logs });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
