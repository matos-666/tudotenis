/**
 * The Odds API adapter — live tennis match-winner odds.
 *
 * Endpoint: https://api.the-odds-api.com/v4/sports/{sport_key}/odds
 * Sport keys actuais: tennis_atp_wimbledon, tennis_wta_wimbledon.
 *
 * Devolve para cada match um array de bookmakers com prices h2h.
 * Para edge detection usamos o MAX entre bookmakers (best available
 * para o user); para reference price usamos Pinnacle se houver, senão
 * Betfair Exchange.
 *
 * Cost-awareness: cada call retorna o full slate da sport_key (~30-50
 * matches). Não chamar mais que 1× por minuto por sport_key.
 */

interface OAOutcome { name: string; price: number; }
interface OAMarket { key: string; last_update: string; outcomes: OAOutcome[]; }
interface OABookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OAMarket[];
}
export interface OddsApiMatch {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OABookmaker[];
}

const API_BASE = 'https://api.the-odds-api.com/v4';

export async function fetchTennisLiveOdds(sportKey: string): Promise<OddsApiMatch[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    console.warn('[odds-api] ODDS_API_KEY missing');
    return [];
  }
  // Apenas 1 region para conservar quota (cada region extra dobra o cost).
  // Region 'eu' inclui Pinnacle, Betfair Exchange EU, casas centrais.
  const url = `${API_BASE}/sports/${sportKey}/odds?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      console.warn(`[odds-api] ${sportKey} HTTP ${r.status}`);
      return [];
    }
    return (await r.json()) as OddsApiMatch[];
  } catch (e) {
    console.warn(`[odds-api] ${sportKey} fetch error:`, e);
    return [];
  }
}

/**
 * Extrai best (max) h2h odds para home/away, ignorando lay markets.
 * Devolve também o "reference price" (Pinnacle > Betfair Exchange >
 * mediana) para auditoria.
 */
export function extractBestOdds(match: OddsApiMatch): {
  oddHome: number | null;
  oddAway: number | null;
  bestHomeBook: string | null;
  bestAwayBook: string | null;
  refHome: number | null;
  refAway: number | null;
  refSource: string | null;
} {
  let oddHome: number | null = null;
  let oddAway: number | null = null;
  let bestHomeBook: string | null = null;
  let bestAwayBook: string | null = null;
  let refHome: number | null = null;
  let refAway: number | null = null;
  let refSource: string | null = null;

  for (const bk of match.bookmakers) {
    const h2h = bk.markets.find(m => m.key === 'h2h');
    if (!h2h) continue;
    const home = h2h.outcomes.find(o => o.name === match.home_team)?.price;
    const away = h2h.outcomes.find(o => o.name === match.away_team)?.price;
    if (home != null) {
      if (oddHome == null || home > oddHome) { oddHome = home; bestHomeBook = bk.key; }
    }
    if (away != null) {
      if (oddAway == null || away > oddAway) { oddAway = away; bestAwayBook = bk.key; }
    }
    // Reference price priority
    const refPriority = ['pinnacle', 'betfair_ex_eu', 'betfair_ex_uk'];
    if (refSource == null && refPriority.includes(bk.key)) {
      refHome = home ?? null;
      refAway = away ?? null;
      refSource = bk.key;
    } else if (refPriority.indexOf(bk.key) < refPriority.indexOf(refSource ?? 'zzz') && refPriority.indexOf(bk.key) >= 0) {
      refHome = home ?? null;
      refAway = away ?? null;
      refSource = bk.key;
    }
  }

  return { oddHome, oddAway, bestHomeBook, bestAwayBook, refHome, refAway, refSource };
}

function strip(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function srNameToFirstLast(srName: string): string {
  const parts = srName.split(',').map(s => s.trim());
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  return srName;
}

/**
 * Match Sportradar names ("Last, First") to OddsAPI names ("First Last").
 * Strategy:
 *   1. Normalize ambos
 *   2. Exact match
 *   3. Last-name match (Sportradar last vs OddsAPI last token)
 *
 * Devolve mapping sr_match_id_hint → oddsapi_match (null se sem match).
 */
export function matchSrToOddsApi(
  srPlayers: Array<{ home: string; away: string }>,
  oaMatches: OddsApiMatch[],
): Map<number, OddsApiMatch | null> {
  const out = new Map<number, OddsApiMatch | null>();
  const oaIndex: Array<{ m: OddsApiMatch; homeNorm: string; awayNorm: string; homeLast: string; awayLast: string }> = oaMatches.map(m => {
    const homeNorm = strip(m.home_team);
    const awayNorm = strip(m.away_team);
    const homeLast = strip(m.home_team.split(' ').slice(-1)[0]);
    const awayLast = strip(m.away_team.split(' ').slice(-1)[0]);
    return { m, homeNorm, awayNorm, homeLast, awayLast };
  });

  srPlayers.forEach((p, i) => {
    const srHomeFL = strip(srNameToFirstLast(p.home));
    const srAwayFL = strip(srNameToFirstLast(p.away));
    const srHomeLast = strip(p.home.split(',')[0]);
    const srAwayLast = strip(p.away.split(',')[0]);

    // Exact (either home↔home/away↔away OR home↔away/away↔home)
    let hit = oaIndex.find(o => (
      (o.homeNorm === srHomeFL && o.awayNorm === srAwayFL) ||
      (o.homeNorm === srAwayFL && o.awayNorm === srHomeFL)
    ));
    if (!hit) {
      // Last-name match
      hit = oaIndex.find(o => (
        (o.homeLast === srHomeLast && o.awayLast === srAwayLast) ||
        (o.homeLast === srAwayLast && o.awayLast === srHomeLast)
      ));
    }
    out.set(i, hit?.m ?? null);
  });

  return out;
}
