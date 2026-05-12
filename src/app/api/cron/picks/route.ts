/**
 * POST /api/cron/picks
 * Cron diário: scrape TennisStats → calcular edge ELO → inserir picks
 *
 * Chamado via:
 *   - Vercel Cron (vercel.json)  — autenticado por CRON_SECRET header
 *   - GitHub Actions             — autenticado pelo mesmo secret
 *   - workflow_dispatch manual
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────
interface ParsedMatch {
  tournamentName: string;
  surface: string;
  p1Name: string;
  p2Name: string;
  p1Odd: number | null;
  p2Odd: number | null;
  status: string;
  scheduledAt: string | null;
}

interface Player {
  id: number;
  name: string;
  flag: string | null;
  // Match-level (legacy, fallback)
  elo_overall: number;
  elo_clay: number;
  elo_hard: number;
  elo_grass: number;
  elo_indoor: number;
  // Set-level (Phase C, preferido — treinado em outcomes de set)
  elo_set_overall: number | null;
  elo_set_clay: number | null;
  elo_set_hard: number | null;
  elo_set_grass: number | null;
}

// ── Config ────────────────────────────────────────────────────────────────
const TENNISSTATS_URL = 'https://tennisstats.com/';
const MIN_EDGE = 5.0;
const MIN_ODD = 1.15;
const MAX_ODD = 8.0;

const SURFACE_MAP: Record<string, string> = {
  clay: 'clay', saibro: 'clay',
  hard: 'hard',
  grass: 'grass',
  carpet: 'indoor', indoor: 'indoor',
};

const IGNORE_RE = [/\bM15\b/i, /\bW15\b/i, /\bM25\b/i, /\bW25\b/i];

// ── Auth ──────────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET ?? process.env.REVALIDATE_SECRET ?? '';
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

// ── Scraper ───────────────────────────────────────────────────────────────
async function fetchTennisStatsHtml(): Promise<string> {
  const res = await fetch(TENNISSTATS_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) throw new Error(`TennisStats HTTP ${res.status}`);
  return res.text();
}

async function fetchMatches(): Promise<ParsedMatch[]> {
  const html = await fetchTennisStatsHtml();
  return parseMatches(html);
}

function parseMatches(html: string): ParsedMatch[] {
  const results: ParsedMatch[] = [];

  // Split by tournament block
  const blocks = html.split("<div class='match-list row cf");

  for (const block of blocks.slice(1)) {
    if (block.includes('format-doubles')) continue;
    if (block.includes('dnone-important')) continue;

    // Tournament name
    const tnM = block.match(/<span class='semi-bold'>([^<]+)<\/span>/);
    const tournamentName = tnM ? tnM[1].trim() : 'Unknown';
    if (IGNORE_RE.some(r => r.test(tournamentName))) continue;

    // Surface
    const pills = [...block.matchAll(/format-highlight small-highlight[^>]*>([^<]+)</g)];
    let surface = 'hard';
    for (const pill of pills) {
      const s = pill[1].trim().toLowerCase();
      if (SURFACE_MAP[s]) { surface = SURFACE_MAP[s]; break; }
    }

    // Match rows
    const matchRE = /<div class='match-row row cf \w+' ><a href='(\/h2h\/[^']+)'[^>]*>([\s\S]*?)<\/a><\/div>/g;
    let mMatch: RegExpExecArray | null;

    while ((mMatch = matchRE.exec(block)) !== null) {
      const inner = mMatch[2];

      // Player rows: both share same structure
      const rowRE = /padding:[37][^;]+;[\s\S]*?box2 bbox'>([^<]+)<[\s\S]*?box3 bbox ac'><span[^>]*>([^<]+)<\/span>/g;
      const rows: [string, string][] = [];
      let rowM: RegExpExecArray | null;
      while ((rowM = rowRE.exec(inner)) !== null) {
        rows.push([rowM[1], rowM[2]]);
      }
      if (rows.length < 2) continue;

      const p1Name = rows[0][0].replace(/\s*\(\d+\)\s*$/, '').replace(/<[^>]+>/g, '').trim();
      const p2Name = rows[1][0].replace(/\s*\(\d+\)\s*$/, '').replace(/<[^>]+>/g, '').trim();
      const p1Odd = parseFloat(rows[0][1]) || null;
      const p2Odd = parseFloat(rows[1][1]) || null;

      const statusM = inner.match(/live-box ac'><p[^>]*>([^<]+)<\/p>/);
      const status = statusM ? statusM[1].trim() : '';

      results.push({
        tournamentName, surface, p1Name, p2Name, p1Odd, p2Odd,
        status, scheduledAt: parseTime(status),
      });
    }
  }

  return results;
}

function parseTime(status: string): string | null {
  const m = status.toLowerCase().match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1]);
  const mn = parseInt(m[2]);
  const ampm = m[3];
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  const today = new Date();
  const dt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h, mn));
  // Subtract 2h (CEST → UTC)
  dt.setUTCHours(dt.getUTCHours() - 2);
  return dt.toISOString();
}

// ── ELO helpers ───────────────────────────────────────────────────────────
function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Devolve o set-ELO da surface (preferido) com fallback para match-level
 * se o jogador ainda não tem set-level ELO populado para essa surface.
 */
function surfaceElo(p: Player, surface: string): number {
  const setField = `elo_set_${surface}` as keyof Player;
  const setVal = p[setField] as number | null | undefined;
  if (setVal != null) return setVal;
  // Fallback: set-overall
  if (p.elo_set_overall != null) return p.elo_set_overall;
  // Final fallback: match-level (deprecated)
  const matchField = `elo_${surface}` as keyof Player;
  return (p[matchField] as number) || p.elo_overall || 1500;
}

function eloWinProb(eloA: number, eloB: number): number {
  return 1.0 / (1.0 + Math.pow(10, (eloB - eloA) / 400));
}

// ── BO5 helpers (Grand Slams ATP) ────────────────────────────────────────
function bo3MatchProb(setProb: number): number {
  const p = setProb, q = 1 - p;
  return p*p + 2*p*p*q;
}
function bo5MatchProb(setProb: number): number {
  const p = setProb, q = 1 - p;
  return p**3 + 3*p**3*q + 6*p**3*q*q;
}
function setProbFromBO3(matchProb: number): number {
  if (matchProb <= 0) return 0;
  if (matchProb >= 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bo3MatchProb(mid) < matchProb) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Ajusta probabilidade ELO (que aproxima BO3) para BO5. */
function adjustForBO5(eloProb: number): number {
  return bo5MatchProb(setProbFromBO3(eloProb));
}

// ATP Grand Slams (BO5 para o lado masculino; WTA continua BO3)
const ATP_SLAM_RE = /\b(australian open|roland garros|french open|wimbledon|us open)\b/i;

function calcEdge(eloProb: number, oddPick: number, oddOpp: number): number {
  const rawPick = 1 / oddPick;
  const rawOpp = 1 / oddOpp;
  const fair = rawPick / (rawPick + rawOpp);
  return (eloProb - fair) * 100;
}

function getGrade(edge: number): 'A' | 'B' | 'C' {
  if (edge >= 12) return 'A';
  if (edge >= 8) return 'B';
  return 'C';
}

// ── Main handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Job tag — admin manual triggers set ?source=manual
  const jobTag = req.nextUrl.searchParams.get('source') === 'manual' ? 'manual_picks' : 'picks';
  const { startCronLog, finishCronLog } = await import('@/lib/cron-log');
  const logId = await startCronLog(jobTag);

  const supa = getServiceSupabase();
  const logs: string[] = [];
  let inserted = 0;

  try {
    // 1. Scrape
    logs.push('📡 Scraping TennisStats…');
    const html = await fetchTennisStatsHtml();
    const allMatches = parseMatches(html);
    logs.push(`   ${allMatches.length} jogos singles encontrados`);

    // 1b. Captura de duplas (registo paralelo, sem gerar picks)
    let doublesCaptured = 0;
    try {
      const { parseDoublesMatches, findOrCreatePlayer, findTournamentId, buildDoublesKey } =
        await import('@/lib/doubles-scrape');
      const dblMatches = parseDoublesMatches(html);
      logs.push(`   ${dblMatches.length} jogos duplas encontrados`);

      for (const dm of dblMatches) {
        try {
          const isWomen = /WTA|Women|W75|W50|W35/i.test(dm.tournamentName);
          const tour: 'atp' | 'wta' = isWomen ? 'wta' : 'atp';
          const dateStr = (dm.scheduledAt ?? new Date().toISOString()).slice(0, 10);

          const externalKey = buildDoublesKey({
            tournamentName: dm.tournamentName,
            date: dateStr,
            t1p1: dm.t1p1Name, t1p2: dm.t1p2Name,
            t2p1: dm.t2p1Name, t2p2: dm.t2p2Name,
          });

          // Skip if já existe
          const { data: existing } = await supa
            .from('doubles_matches')
            .select('id')
            .eq('external_key', externalKey)
            .limit(1);
          if (existing?.length) continue;

          // Lookup / create os 4 jogadores
          const [p1, p2, p3, p4] = await Promise.all([
            findOrCreatePlayer(supa, dm.t1p1Name, tour),
            findOrCreatePlayer(supa, dm.t1p2Name, tour),
            findOrCreatePlayer(supa, dm.t2p1Name, tour),
            findOrCreatePlayer(supa, dm.t2p2Name, tour),
          ]);
          if (!p1 || !p2 || !p3 || !p4) {
            logs.push(`  ⚠ duplas: jogador não resolvido em ${dm.tournamentName}`);
            continue;
          }

          // Tournament id (best-effort)
          const tid = await findTournamentId(supa, dm.tournamentName, parseInt(dateStr.slice(0, 4)));

          const { error: insErr } = await supa.from('doubles_matches').insert({
            source: 'tennisstats',
            external_key: externalKey,
            tournament_id: tid,
            tournament_name: dm.tournamentName,
            date: dateStr,
            scheduled_at: dm.scheduledAt,
            surface: dm.surface,
            t1_p1_id: p1.id,
            t1_p2_id: p2.id,
            t2_p1_id: p3.id,
            t2_p2_id: p4.id,
            t1_p1_name: dm.t1p1Name,
            t1_p2_name: dm.t1p2Name,
            t2_p1_name: dm.t2p1Name,
            t2_p2_name: dm.t2p2Name,
          });
          if (insErr) {
            logs.push(`  ❌ duplas insert: ${insErr.message}`);
            continue;
          }
          doublesCaptured++;
        } catch (e) {
          logs.push(`  ⚠ duplas: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (doublesCaptured > 0) logs.push(`   ${doublesCaptured} novos jogos duplas capturados`);
    } catch (e) {
      logs.push(`  ⚠ duplas pipeline error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Filter upcoming
    const TERMINAL = new Set(['Fin.', 'Ret.', 'Canc.', 'Walko.', 'W.O.', 'Serving', 'Susp.', '']);
    const upcoming = allMatches.filter(m => !TERMINAL.has(m.status));
    logs.push(`   ${upcoming.length} por jogar hoje`);

    if (upcoming.length === 0) {
      await finishCronLog(logId, true, 'no upcoming matches', { inserted: 0, logs });
      return NextResponse.json({ ok: true, inserted: 0, logs });
    }

    // 3. Check existing picks today
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: existing } = await supa
      .from('picks')
      .select('p1_name, p2_name, tournament_name')
      .gte('posted_at', `${todayStr}T00:00:00`);

    const existingSet = new Set(
      (existing ?? []).map(r => `${r.p1_name}|${r.p2_name}|${r.tournament_name}`)
    );

    // 4. Player ELO cache
    const playerCache = new Map<string, Player | null>();

    async function getPlayer(name: string): Promise<Player | null> {
      if (playerCache.has(name)) return playerCache.get(name) ?? null;

      const slug = slugify(name);
      let { data } = await supa
        .from('players')
        .select('id,name,flag,elo_overall,elo_clay,elo_hard,elo_grass,elo_indoor,elo_set_overall,elo_set_clay,elo_set_hard,elo_set_grass')
        .eq('slug', slug)
        .limit(1);

      if (!data?.length) {
        // Fuzzy: ilike
        ({ data } = await supa
          .from('players')
          .select('id,name,flag,elo_overall,elo_clay,elo_hard,elo_grass,elo_indoor,elo_set_overall,elo_set_clay,elo_set_hard,elo_set_grass')
          .ilike('name', `%${name.split(' ')[0]}%${name.split(' ').at(-1)}%`)
          .limit(1));
      }

      const player = data?.[0] ?? null;
      playerCache.set(name, player);
      return player;
    }

    // 5. Evaluate each match
    for (const m of upcoming) {
      const key1 = `${m.p1Name}|${m.p2Name}|${m.tournamentName}`;
      const key2 = `${m.p2Name}|${m.p1Name}|${m.tournamentName}`;
      if (existingSet.has(key1) || existingSet.has(key2)) continue;

      if (!m.p1Odd || !m.p2Odd) continue;
      if (m.p1Odd > MAX_ODD && m.p2Odd > MAX_ODD) continue;

      const [p1, p2] = await Promise.all([getPlayer(m.p1Name), getPlayer(m.p2Name)]);
      if (!p1 || !p2) {
        const missing = !p1 ? m.p1Name : m.p2Name;
        logs.push(`  ⚠ Não encontrado: ${missing}`);
        continue;
      }

      const elo1 = surfaceElo(p1, m.surface);
      const elo2 = surfaceElo(p2, m.surface);

      // surfaceElo() devolve preferencialmente set-level ELO. Aplicamos
      // eloWinProb → setProb directamente, depois compomos para BO3/BO5.
      const setProb = eloWinProb(elo1, elo2);
      const isWomen = /WTA|Women|W75|W50|W35|W25|W15/i.test(m.tournamentName);
      const isAtpSlam = !isWomen && ATP_SLAM_RE.test(m.tournamentName);
      const prob1 = isAtpSlam ? bo5MatchProb(setProb) : bo3MatchProb(setProb);
      const prob2 = 1 - prob1;

      const candidates = [
        { player: p1, opp: p2, odd: m.p1Odd, oddOpp: m.p2Odd, prob: prob1 },
        { player: p2, opp: p1, odd: m.p2Odd, oddOpp: m.p1Odd, prob: prob2 },
      ];

      for (const c of candidates) {
        if (!c.odd || c.odd < MIN_ODD || c.odd > MAX_ODD) continue;
        const edge = calcEdge(c.prob, c.odd, c.oddOpp);
        if (edge < MIN_EDGE) continue;

        const grade = getGrade(edge);
        const market = isWomen ? 'Vencedora' : 'Vencedor';

        const row = {
          player_id:       c.player.id,
          market,
          selection:       c.player.name,
          odd:             c.odd,
          edge_pct:        Math.round(edge * 100) / 100,
          grade,
          stake:           10,
          source:          'tennisstats',
          p1_name:         c.player.name,
          p2_name:         c.opp.name,
          p1_flag:         c.player.flag ?? '🎾',
          p2_flag:         c.opp.flag ?? '🎾',
          tournament_name: m.tournamentName,
          surface:         m.surface,
          scheduled_at:    m.scheduledAt,
        };

        const { error } = await supa.from('picks').insert(row);
        if (!error) {
          inserted++;
          logs.push(`  ✅ ${grade}  ${c.player.name} vs ${c.opp.name}  @${c.odd.toFixed(2)}  edge=${edge.toFixed(1)}%`);
          existingSet.add(`${c.player.name}|${c.opp.name}|${m.tournamentName}`);
        } else {
          logs.push(`  ❌ Insert error: ${error.message}`);
        }
      }
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`❌ Error: ${msg}`);
    await finishCronLog(logId, false, msg, { inserted, logs });
    return NextResponse.json({ ok: false, error: msg, logs }, { status: 500 });
  }

  logs.push(`\n✅ ${inserted} pick(s) inseridos.`);
  await finishCronLog(logId, true, `inserted=${inserted}`, { inserted, logs });
  return NextResponse.json({ ok: true, inserted, logs });
}
// Note: `doublesCaptured` count vai no array `logs` — visível no admin/cron.

// Also support GET for Vercel Cron (sends GET with auth header)
export async function GET(req: NextRequest) {
  return POST(req);
}
