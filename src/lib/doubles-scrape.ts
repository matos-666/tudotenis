/**
 * Helpers para parsing/captura de jogos de duplas a partir do TennisStats HTML
 * e gestão da tabela `doubles_matches`.
 *
 * Convenções:
 *   - Nome de equipa: "Player1 / Player2"
 *   - external_key (dedupe): tournament-date-slug(p1).slug(p2)-vs-slug(p3).slug(p4)
 *     com slugs ordenados dentro de cada equipa para invariância à ordem.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ParsedDoublesMatch {
  tournamentName: string;
  surface: string;
  t1p1Name: string;
  t1p2Name: string;
  t2p1Name: string;
  t2p2Name: string;
  t1Odd: number | null;
  t2Odd: number | null;
  status: string;            // ex: "10:30am", "Fin.", "Set 2"
  scheduledAt: string | null;
}

export interface ParsedDoublesFinished {
  t1p1Name: string;
  t1p2Name: string;
  t2p1Name: string;
  t2p2Name: string;
  t1Sets: number;
  t2Sets: number;
  status: string;            // 'Fin.' | 'Ret.' | 'Walko.' | 'W.O.' | 'Canc.'
}

const SURFACE_MAP: Record<string, string> = {
  clay: 'clay', saibro: 'clay',
  hard: 'hard',
  grass: 'grass',
  carpet: 'indoor', indoor: 'indoor',
};
const IGNORE_RE = [/\bM15\b/i, /\bW15\b/i, /\bM25\b/i, /\bW25\b/i];

export function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
  dt.setUTCHours(dt.getUTCHours() - 2); // CEST → UTC
  return dt.toISOString();
}

/**
 * Parse format-doubles blocks. Devolve cada match com 4 nomes (split por "/")
 * e odds opcionais.
 */
export function parseDoublesMatches(html: string): ParsedDoublesMatch[] {
  const results: ParsedDoublesMatch[] = [];
  const blocks = html.split("<div class='match-list row cf");

  for (const block of blocks.slice(1)) {
    if (!block.includes('format-doubles')) continue;
    // Nota: NÃO skip dnone-important — TennisStats marca os blocks de duplas
    // como hidden por default na UI, mas os dados estão lá.

    const tnM = block.match(/<span class='semi-bold'>([^<]+)<\/span>/);
    const tournamentName = tnM ? tnM[1].trim() : 'Unknown';
    if (IGNORE_RE.some(r => r.test(tournamentName))) continue;

    const pills = [...block.matchAll(/format-highlight small-highlight[^>]*>([^<]+)</g)];
    let surface = 'hard';
    for (const pill of pills) {
      const s = pill[1].trim().toLowerCase();
      if (SURFACE_MAP[s]) { surface = SURFACE_MAP[s]; break; }
    }

    // class pode ter tokens extra (ex.: 'cf 127150ub plo') e href pode ser
    // /h2h/... (logado / matches abertos) ou /premium (locked).
    const matchRE = /<div class='match-row row cf [^']+' ><a href='[^']+'[^>]*>([\s\S]*?)<\/a><\/div>/g;
    let mMatch: RegExpExecArray | null;

    while ((mMatch = matchRE.exec(block)) !== null) {
      const inner = mMatch[1];

      const rowRE = /padding:[37][^;]+;[\s\S]*?box2 bbox'>([^<]+)<[\s\S]*?box3 bbox ac'><span[^>]*>([^<]+)<\/span>/g;
      const rows: [string, string][] = [];
      let rowM: RegExpExecArray | null;
      while ((rowM = rowRE.exec(inner)) !== null) {
        rows.push([rowM[1], rowM[2]]);
      }
      if (rows.length < 2) continue;

      const t1Raw = rows[0][0].replace(/\s*\(\d+\s*\/?\s*\d*\)\s*$/, '').replace(/<[^>]+>/g, '').trim();
      const t2Raw = rows[1][0].replace(/\s*\(\d+\s*\/?\s*\d*\)\s*$/, '').replace(/<[^>]+>/g, '').trim();
      // TennisStats formato duplas: "Lastname1 - Lastname2"  (separador " - ")
      // Fallback: também aceitar "/" para robustez futura
      const splitRe = /\s+-\s+|\s*\/\s*/;
      const t1 = t1Raw.split(splitRe).map(s => s.trim()).filter(Boolean);
      const t2 = t2Raw.split(splitRe).map(s => s.trim()).filter(Boolean);
      if (t1.length !== 2 || t2.length !== 2) continue;

      const t1Odd = parseFloat(rows[0][1]) || null;
      const t2Odd = parseFloat(rows[1][1]) || null;

      const statusM = inner.match(/live-box ac'><p[^>]*>([^<]+)<\/p>/);
      const status = statusM ? statusM[1].trim() : '';

      results.push({
        tournamentName, surface,
        t1p1Name: t1[0], t1p2Name: t1[1],
        t2p1Name: t2[0], t2p2Name: t2[1],
        t1Odd, t2Odd,
        status, scheduledAt: parseTime(status),
      });
    }
  }

  return results;
}

/**
 * Parse format-doubles blocks com resultado terminal (Fin./Ret./W.O./Canc./Walko.).
 */
export function parseDoublesFinished(html: string): ParsedDoublesFinished[] {
  const out: ParsedDoublesFinished[] = [];
  const blocks = html.split("<div class='match-list row cf");

  for (const block of blocks.slice(1)) {
    if (!block.includes('format-doubles')) continue;
    // Nota: NÃO skip dnone-important — TennisStats marca os blocks de duplas
    // como hidden por default na UI, mas os dados estão lá.

    // class pode ter tokens extra (ex.: 'cf 127150ub plo') e href pode ser
    // /h2h/... (logado / matches abertos) ou /premium (locked).
    const matchRE = /<div class='match-row row cf [^']+' ><a href='[^']+'[^>]*>([\s\S]*?)<\/a><\/div>/g;
    let mm: RegExpExecArray | null;

    while ((mm = matchRE.exec(block)) !== null) {
      const inner = mm[1];

      const rowRE = /padding:[37][^;]+;[\s\S]*?box2 bbox'>([^<]+)<[\s\S]*?set-box ac'><p[^>]*>([^<]+)<\/p>/g;
      const rows: [string, string][] = [];
      let rm: RegExpExecArray | null;
      while ((rm = rowRE.exec(inner)) !== null) {
        rows.push([rm[1], rm[2]]);
      }
      if (rows.length < 2) continue;

      const statusM = inner.match(/live-box ac'><p[^>]*>([^<]+)<\/p>/);
      const status = statusM ? statusM[1].trim() : '';
      if (!['Fin.', 'Ret.', 'Walko.', 'W.O.', 'Canc.'].includes(status)) continue;

      const t1Raw = rows[0][0].replace(/\s*\(\d+\s*\/?\s*\d*\)\s*$/, '').replace(/<[^>]+>/g, '').trim();
      const t2Raw = rows[1][0].replace(/\s*\(\d+\s*\/?\s*\d*\)\s*$/, '').replace(/<[^>]+>/g, '').trim();
      // TennisStats formato duplas: "Lastname1 - Lastname2"  (separador " - ")
      // Fallback: também aceitar "/" para robustez futura
      const splitRe = /\s+-\s+|\s*\/\s*/;
      const t1 = t1Raw.split(splitRe).map(s => s.trim()).filter(Boolean);
      const t2 = t2Raw.split(splitRe).map(s => s.trim()).filter(Boolean);
      if (t1.length !== 2 || t2.length !== 2) continue;

      const t1Sets = parseInt(rows[0][1].trim()) || 0;
      const t2Sets = parseInt(rows[1][1].trim()) || 0;

      out.push({
        t1p1Name: t1[0], t1p2Name: t1[1],
        t2p1Name: t2[0], t2p2Name: t2[1],
        t1Sets, t2Sets, status,
      });
    }
  }
  return out;
}

/**
 * Find or create a player by name. Returns the player id.
 *
 * Strategy:
 *   1. Lookup by slug
 *   2. If not found, try fuzzy match on last name
 *   3. If still nothing, INSERT a new row with minimal fields
 *
 * tour é 'atp' / 'wta' inferido pelo caller (default 'atp').
 */
export async function findOrCreatePlayer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: SupabaseClient<any, 'public', 'public', any, any>,
  name: string,
  tour: 'atp' | 'wta' = 'atp'
): Promise<{ id: number; slug: string; created: boolean } | null> {
  const slug = slugify(name);
  if (!slug) return null;
  const words = name.trim().split(/\s+/);
  const isLastNameOnly = words.length === 1;

  // 1. Exact slug match (apenas se tivermos nome completo)
  if (!isLastNameOnly) {
    const { data: exact } = await supa
      .from('players')
      .select('id, slug')
      .eq('slug', slug)
      .limit(1);
    if (exact?.length) return { id: exact[0].id as number, slug: exact[0].slug as string, created: false };
  }

  // 2. Lookup por apelido (último token) — comum em duplas onde TennisStats
  //    devolve só "Lastname". Filtra por tour e ordena por activity.
  const lastName = words[words.length - 1];
  if (lastName && lastName.length >= 3) {
    const { data: fz } = await supa
      .from('players')
      .select('id, slug, name, tour, active, elo_overall, atp_rank')
      .ilike('name', `% ${lastName}`)            // termina em " Lastname"
      .eq('tour', tour)
      .order('active', { ascending: false })
      .order('atp_rank', { ascending: true, nullsFirst: false })
      .order('elo_overall', { ascending: false, nullsFirst: false })
      .limit(10);

    if (fz?.length) {
      // Se temos nome completo, tenta match mais apertado por iniciais
      if (!isLastNameOnly) {
        const initials = words.map(p => p[0]?.toLowerCase()).join('');
        for (const p of fz) {
          const pInitials = (p.name as string).split(/\s+/).map((q: string) => q[0]?.toLowerCase()).join('');
          if (pInitials === initials) {
            return { id: p.id as number, slug: p.slug as string, created: false };
          }
        }
      }
      // Senão, devolve o mais relevante (já ordenado: active+rank+elo)
      return { id: fz[0].id as number, slug: fz[0].slug as string, created: false };
    }

    // Fallback: também procurar com substring em qualquer parte do nome
    // (cobre casos como "Saint-Pierre" / acentos esquisitos)
    const { data: fz2 } = await supa
      .from('players')
      .select('id, slug, name, tour, active, elo_overall, atp_rank')
      .ilike('name', `%${lastName}%`)
      .eq('tour', tour)
      .order('active', { ascending: false })
      .order('atp_rank', { ascending: true, nullsFirst: false })
      .limit(5);
    if (fz2?.length) {
      return { id: fz2[0].id as number, slug: fz2[0].slug as string, created: false };
    }
  }

  // 3. Não encontrado — cria. Para apelidos isolados, marca slug como
  //    "lastname-doubles-XXX" para não colidir com singles cujo full name
  //    inclua esse apelido. Geramos sufixo aleatório curto.
  let createSlug = slug;
  let createName = name;
  if (isLastNameOnly) {
    const sfx = Math.random().toString(36).slice(2, 5);
    createSlug = `${slug}-d${sfx}`;
    createName = name; // mantém o lastname puro como nome (admin pode editar depois)
  }

  const { data: created, error } = await supa
    .from('players')
    .insert({ slug: createSlug, name: createName, tour, active: true })
    .select('id, slug')
    .single();
  if (error || !created) {
    console.warn(`[findOrCreatePlayer] failed for "${name}": ${error?.message}`);
    return null;
  }
  return { id: created.id as number, slug: created.slug as string, created: true };
}

/**
 * Find a tournament id by name + year.
 * ILIKE match (TennisStats name may differ slightly from Sackmann).
 */
export async function findTournamentId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: SupabaseClient<any, 'public', 'public', any, any>,
  name: string,
  year: number
): Promise<number | null> {
  const cleaned = name.replace(/\bATP\b|\bWTA\b/gi, '').trim();
  if (!cleaned) return null;

  // Tenta exact name first
  const { data: exact } = await supa
    .from('tournaments')
    .select('id')
    .ilike('name', cleaned)
    .eq('year', year)
    .limit(1);
  if (exact?.length) return exact[0].id as number;

  // Tenta sem 'Open', 'Masters' suffixes
  const stripped = cleaned.replace(/\b(open|masters|cup|championships?)\b/gi, '').trim();
  if (stripped && stripped !== cleaned) {
    const { data } = await supa
      .from('tournaments')
      .select('id')
      .ilike('name', `%${stripped}%`)
      .eq('year', year)
      .limit(1);
    if (data?.length) return data[0].id as number;
  }

  return null;
}

/**
 * Build canonical external_key for dedupe.
 * Sorts within each team and decides which team is "side A" by lexical order.
 */
export function buildDoublesKey(args: {
  tournamentName: string;
  date: string; // YYYY-MM-DD
  t1p1: string;
  t1p2: string;
  t2p1: string;
  t2p2: string;
}): string {
  const [t1a, t1b] = [slugify(args.t1p1), slugify(args.t1p2)].sort();
  const [t2a, t2b] = [slugify(args.t2p1), slugify(args.t2p2)].sort();
  const team1 = `${t1a}.${t1b}`;
  const team2 = `${t2a}.${t2b}`;
  const [sideA, sideB] = [team1, team2].sort();
  const tslug = slugify(args.tournamentName);
  return `${tslug}-${args.date}-${sideA}-vs-${sideB}`;
}
