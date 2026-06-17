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
  /** Slug TennisStats h2h (e.g. "sinner-vs-zverev-576276") — chave única
   *  por match para deduplicar entre cron runs. */
  tennisstatsSlug: string | null;
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
  // Sample size — usado como filtro de confiança para picks
  set_count: number | null;
}

// ── Config ────────────────────────────────────────────────────────────────
const TENNISSTATS_URL = 'https://tennisstats.com/';
const MIN_EV = 5.0;            // EV% mínimo para considerar um pick (5% ROI esperado)
const MAX_EV = 40.0;           // EV% máximo plausível — acima disto, sample insuficiente
const MIN_SETS_REGULAR = 80;   // ATP/WTA tour, 250+, M1000: mínimo de sets de cada jogador
const MIN_SETS_SLAM    = 100;  // Slams: era 150 mas muitos qualificados têm
                               // só 100-130 sets em nossa training data. Baixado
                               // para apanhar Roland Garros quali (32+32 jogos)
const MIN_SETS_CHALL   = 50;   // Challengers / ITF: threshold mais baixo
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
    // Bug-fix: checar APENAS a outer class (até ao primeiro `'`) — antes
    // checava-se o bloco todo, mas o HTML do TennisStats agora tem strings
    // "format-doubles" e "dnone-important" embedded como toggles internos
    // em blocos de singles (vimos isto matar a Strasbourg WTA p.ex.).
    const closeQ = block.indexOf("'");
    const outerClass = closeQ > 0 ? block.substring(0, closeQ) : block;
    if (outerClass.includes('format-doubles')) continue;
    if (outerClass.includes('dnone-important')) continue;

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
      const h2hHref = mMatch[1]; // e.g. "/h2h/sinner-vs-zverev-576276"
      const tennisstatsSlug = h2hHref.replace(/^\/h2h\//, '');
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
        status, scheduledAt: parseTime(status), tennisstatsSlug,
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

/**
 * EV% = (modelProb × odd_real − 1) × 100
 *
 * Usa a odd real (com margem da casa), porque é o que recebemos se
 * apostarmos. EV positivo significa lucro esperado por unidade apostada
 * a longo prazo — exemplo: EV +6% em €10 stake = +€0.60 expected/match.
 *
 * Anteriormente este helper devolvia a diferença de probabilidades
 * (modelProb − fair_devigged), que é "edge" (medido em pontos
 * percentuais de probabilidade). EV é o correcto para decidir picks.
 */
function calcEV(modelProb: number, oddPick: number): number {
  return (modelProb * oddPick - 1) * 100;
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

    // 1b. Captura de duplas + geração de picks doubles
    //
    // Pipeline: parse → captura no doubles_matches → para upcoming com odds,
    // calcula team ELO + EV → insere em doubles_picks.
    //
    // Threshold de confidence: cada jogador precisa ≥10 doubles_matches na
    // DB (set_count equivalente para duplas). Auto-created players (ainda
    // com elo=1500) ficam fora — evita EVs absurdos.
    const TERMINAL_DBL = new Set(['Fin.', 'Ret.', 'Canc.', 'Walko.', 'W.O.', 'Serving', 'Susp.', '']);
    const MIN_DBL_MATCHES = 10;        // por jogador
    let doublesCaptured = 0;
    let doublesPicksInserted = 0;
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

          // Skip if já existe doubles_match
          const { data: existingMatch } = await supa
            .from('doubles_matches')
            .select('id')
            .eq('external_key', externalKey)
            .limit(1);

          let doublesMatchId: number | null = existingMatch?.[0]?.id ?? null;

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

          if (!doublesMatchId) {
            // Tournament id (best-effort)
            const tid = await findTournamentId(supa, dm.tournamentName, parseInt(dateStr.slice(0, 4)));

            const { data: newMatch, error: insErr } = await supa.from('doubles_matches').insert({
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
            }).select('id').single();
            if (insErr) {
              logs.push(`  ❌ duplas insert: ${insErr.message}`);
              continue;
            }
            doublesMatchId = newMatch.id as number;
            doublesCaptured++;
          }

          // ── Geração de pick doubles ──────────────────────────────────
          // Só gera se: match upcoming + odds presentes + sample suficiente
          if (TERMINAL_DBL.has(dm.status)) continue;
          if (!dm.t1Odd || !dm.t2Odd) continue;
          if (dm.t1Odd > MAX_ODD && dm.t2Odd > MAX_ODD) continue;

          // Fetch ELOs doubles dos 4 jogadores
          const { data: doublesPlayers } = await supa
            .from('players')
            .select('id, name, flag, elo_doubles_overall, elo_doubles_hard, elo_doubles_clay, elo_doubles_grass, doubles_matches')
            .in('id', [p1.id, p2.id, p3.id, p4.id]);

          if (!doublesPlayers || doublesPlayers.length !== 4) {
            logs.push(`  ⚠ duplas: ELO lookup falhou para ${dm.tournamentName}`);
            continue;
          }
          const byId = new Map(doublesPlayers.map(d => [d.id as number, d]));
          const dp1 = byId.get(p1.id)!;
          const dp2 = byId.get(p2.id)!;
          const dp3 = byId.get(p3.id)!;
          const dp4 = byId.get(p4.id)!;

          // Filtro de confidence — todos ≥10 matches doubles
          const minMatches = Math.min(
            dp1.doubles_matches ?? 0,
            dp2.doubles_matches ?? 0,
            dp3.doubles_matches ?? 0,
            dp4.doubles_matches ?? 0,
          );
          if (minMatches < MIN_DBL_MATCHES) continue;

          // Team ELO: prefer surface se disponível, fallback overall
          const surfKey = dm.surface === 'clay' ? 'elo_doubles_clay'
                        : dm.surface === 'grass' ? 'elo_doubles_grass'
                        : 'elo_doubles_hard';
          const eloFor = (p: typeof dp1) => {
            const surfVal = p[surfKey as keyof typeof p] as number | null;
            return surfVal ?? p.elo_doubles_overall ?? 1500;
          };
          const t1Elo = (eloFor(dp1) + eloFor(dp2)) / 2;
          const t2Elo = (eloFor(dp3) + eloFor(dp4)) / 2;

          // Set prob via ELO, depois BO3 (doubles sempre BO3 com super tiebreak)
          const setProb = eloWinProb(t1Elo, t2Elo);
          const probT1 = bo3MatchProb(setProb);
          const probT2 = 1 - probT1;

          // Avalia ambos os lados — pega o melhor EV
          const teamCandidates = [
            { team: 1 as const, prob: probT1, odd: dm.t1Odd },
            { team: 2 as const, prob: probT2, odd: dm.t2Odd },
          ];
          for (const tc of teamCandidates) {
            if (tc.odd < MIN_ODD || tc.odd > MAX_ODD) continue;
            const ev = calcEV(tc.prob, tc.odd);
            if (ev < MIN_EV || ev > MAX_EV) continue;
            const grade = getGrade(ev);
            const market = isWomen ? 'Vencedora dupla' : 'Vencedora dupla';

            const pickRow = {
              doubles_match_id: doublesMatchId,
              external_key: externalKey,
              source: 'tennisstats',
              team_selected: tc.team,
              t1_p1_id: p1.id, t1_p2_id: p2.id,
              t2_p1_id: p3.id, t2_p2_id: p4.id,
              t1_p1_name: dm.t1p1Name, t1_p2_name: dm.t1p2Name,
              t2_p1_name: dm.t2p1Name, t2_p2_name: dm.t2p2Name,
              t1_p1_flag: dp1.flag ?? '🎾', t1_p2_flag: dp2.flag ?? '🎾',
              t2_p1_flag: dp3.flag ?? '🎾', t2_p2_flag: dp4.flag ?? '🎾',
              market,
              odd: tc.odd,
              edge_pct: Math.round(ev * 100) / 100,
              grade,
              stake: 10,
              tournament_name: dm.tournamentName,
              surface: dm.surface,
              scheduled_at: dm.scheduledAt,
            };
            const { error: pickErr } = await supa.from('doubles_picks').insert(pickRow);
            if (!pickErr) {
              doublesPicksInserted++;
              const teamNames = tc.team === 1
                ? `${dm.t1p1Name}/${dm.t1p2Name}`
                : `${dm.t2p1Name}/${dm.t2p2Name}`;
              logs.push(`  ✅ DBL ${grade}  ${teamNames}  @${tc.odd.toFixed(2)}  EV=${ev.toFixed(1)}%`);
            } else if (!/duplicate|unique/i.test(pickErr.message)) {
              logs.push(`  ❌ doubles_picks insert: ${pickErr.message}`);
            }
          }
        } catch (e) {
          logs.push(`  ⚠ duplas: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (doublesCaptured > 0) logs.push(`   ${doublesCaptured} novos jogos duplas capturados`);
      if (doublesPicksInserted > 0) logs.push(`   ${doublesPicksInserted} picks duplas inseridos`);
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
      .select('p1_name, p2_name, tournament_name, tennisstats_slug')
      .gte('posted_at', `${todayStr}T00:00:00`);

    // Dedup por slug (preferido — chave única do TennisStats) + por nomes
    // (fallback para picks legacy sem slug)
    const existingSet = new Set(
      (existing ?? []).map(r => `${r.p1_name}|${r.p2_name}|${r.tournament_name}`)
    );
    const existingSlugSet = new Set(
      (existing ?? [])
        .map(r => r.tennisstats_slug as string | null)
        .filter((s): s is string => !!s)
    );

    // 4. Player ELO cache
    const playerCache = new Map<string, Player | null>();

    async function getPlayer(name: string): Promise<Player | null> {
      if (playerCache.has(name)) return playerCache.get(name) ?? null;

      const slug = slugify(name);
      let { data } = await supa
        .from('players')
        .select('id,name,flag,elo_overall,elo_clay,elo_hard,elo_grass,elo_indoor,elo_set_overall,elo_set_clay,elo_set_hard,elo_set_grass,set_count')
        .eq('slug', slug)
        .limit(1);

      if (!data?.length) {
        // Fuzzy: ilike
        ({ data } = await supa
          .from('players')
          .select('id,name,flag,elo_overall,elo_clay,elo_hard,elo_grass,elo_indoor,elo_set_overall,elo_set_clay,elo_set_hard,elo_set_grass,set_count')
          .ilike('name', `%${name.split(' ')[0]}%${name.split(' ').at(-1)}%`)
          .limit(1));
      }

      const player = data?.[0] ?? null;
      playerCache.set(name, player);
      return player;
    }

    // 5. Evaluate each match
    for (const m of upcoming) {
      // Dedup primary: slug TennisStats (estável entre cron runs)
      if (m.tennisstatsSlug && existingSlugSet.has(m.tennisstatsSlug)) continue;
      // Fallback: nomes (apanha picks legacy sem slug)
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

      // ── Filtro de confidence: ambos os jogadores precisam de histórico
      //    mínimo de sets na nossa DB. Sem isto, ELO instável produz
      //    EVs absurdos (200%+) em qualifying / lower-tier.
      const isWomen   = /WTA|Women|W75|W50|W35|W25|W15/i.test(m.tournamentName);
      const isAtpSlam = !isWomen && ATP_SLAM_RE.test(m.tournamentName);
      const isSlam    = /Grand Slam|French Open|Roland Garros|Wimbledon|US Open|Australian Open/i.test(m.tournamentName);
      const isChall   = /Chall\.|Challenger|ITF/i.test(m.tournamentName);

      const minSets = isSlam ? MIN_SETS_SLAM : isChall ? MIN_SETS_CHALL : MIN_SETS_REGULAR;
      const sets1 = p1.set_count ?? 0;
      const sets2 = p2.set_count ?? 0;
      if (sets1 < minSets || sets2 < minSets) {
        logs.push(`  ⚠ Amostra insuficiente (${sets1}/${sets2} < ${minSets}): ${p1.name} vs ${p2.name}`);
        continue;
      }

      const elo1 = surfaceElo(p1, m.surface);
      const elo2 = surfaceElo(p2, m.surface);

      // surfaceElo() devolve preferencialmente set-level ELO. Aplicamos
      // eloWinProb → setProb directamente, depois compomos para BO3/BO5.
      const setProb = eloWinProb(elo1, elo2);
      const prob1 = isAtpSlam ? bo5MatchProb(setProb) : bo3MatchProb(setProb);
      const prob2 = 1 - prob1;

      const candidates = [
        { player: p1, opp: p2, odd: m.p1Odd, oddOpp: m.p2Odd, prob: prob1 },
        { player: p2, opp: p1, odd: m.p2Odd, oddOpp: m.p1Odd, prob: prob2 },
      ];

      for (const c of candidates) {
        if (!c.odd || c.odd < MIN_ODD || c.odd > MAX_ODD) continue;
        const ev = calcEV(c.prob, c.odd);
        if (ev < MIN_EV) continue;
        if (ev > MAX_EV) {
          // EV implausivelmente alto → quase sempre erro de sample. Skip.
          logs.push(`  ⚠ EV implausível (${ev.toFixed(1)}%): ${c.player.name} @${c.odd} — skip`);
          continue;
        }

        const grade = getGrade(ev);
        const market = isWomen ? 'Vencedora' : 'Vencedor';

        const row = {
          player_id:       c.player.id,
          market,
          selection:       c.player.name,
          odd:             c.odd,
          edge_pct:        Math.round(ev * 100) / 100, // column é legacy "edge_pct" mas armazena EV%
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
          tennisstats_slug: m.tennisstatsSlug,
        };

        const { error } = await supa.from('picks').insert(row);
        if (!error) {
          inserted++;
          logs.push(`  ✅ ${grade}  ${c.player.name} vs ${c.opp.name}  @${c.odd.toFixed(2)}  EV=${ev.toFixed(1)}%`);
          existingSet.add(`${c.player.name}|${c.opp.name}|${m.tournamentName}`);
          if (m.tennisstatsSlug) existingSlugSet.add(m.tennisstatsSlug);
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
