/**
 * Oddschecker outrights scraper.
 *
 * AVISO LEGAL: A scrape do Oddschecker é zona cinzenta. Uso defensivo:
 *   - 1 request/dia/URL (cron diário)
 *   - User-Agent realista (não bot identificável)
 *   - Rate-limit interno de ~4s entre fetches sequenciais
 *   - Sem revenda nem redistribuição directa das odds — só agregamos
 *     "best decimal" para comparação contra o nosso modelo.
 *
 * Cloudflare deixa passar um GET com fingerprint de browser razoável.
 * Se algum dia bloquear, opções:
 *   1. Mover cron para GitHub Actions (IPs diferentes de Vercel)
 *   2. Adicionar serviço de proxy (ScraperAPI, Bright Data — pago)
 */

export interface ScrapedOutright {
  rawName: string;
  bestDecimal: number;
  bestBookies: string;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-ch-ua':
    '"Not_A Brand";v="8", "Chromium";v="124", "Google Chrome";v="124"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
  Referer: 'https://www.oddschecker.com/tennis',
};

export async function fetchOddscheckerHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    // Bypass Next.js cache — cron sempre quer fresh
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Oddschecker HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

/**
 * Parser de outrights. O HTML do Oddschecker tem atributos (todos no mesmo
 * <tr ...>):
 *   data-bname="Player Name"       → nome do jogador
 *   data-best-bks="PUP,BRS"         → códigos dos bookmakers com a best odd
 *   data-best-dig-wo="6.29"         → best decimal odds (gross return)
 *
 * O atributo "wo" significa "without each-way" — é a odd straight-win
 * que queremos. Existe também "data-best-dig-ea" para each-way, ignorado.
 *
 * Estratégia: para cada <tr ...> que tem data-bname, isolar o tag inteiro
 * (até ao primeiro `>`) e correr regex menores aos atributos. Robusto a
 * mudanças de ordem dos atributos e a tags com muitos KB de payload (a row
 * tem um data-initial-odds-state enorme com todas as bookmakers).
 */
export function parseOutrights(html: string): ScrapedOutright[] {
  const trRe = /<tr\b[^>]*\bdata-bname="([^"]+)"[^>]*>/g;
  const out: ScrapedOutright[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    const fullTag = m[0];
    const rawName = m[1].trim();
    if (seen.has(rawName)) continue;
    const decM = /data-best-dig-wo="([^"]+)"/.exec(fullTag);
    if (!decM) continue;
    const dec = parseFloat(decM[1]);
    if (!isFinite(dec) || dec <= 1.001) continue;
    const bksM = /data-best-bks="([^"]*)"/.exec(fullTag);
    seen.add(rawName);
    out.push({
      rawName,
      bestDecimal: dec,
      bestBookies: bksM ? bksM[1].trim() : '',
    });
  }
  return out;
}

/**
 * Normaliza um nome para comparação: NFD + remove diacríticos, lowercase,
 * só letras e espaços, sem hífenes ou apóstrofos.
 *   "Félix Auger-Aliassime" → "felix auger aliassime"
 *   "O'Connell"             → "oconnell"
 */
// Combining diacriticals (U+0300 — U+036F) — built via RegExp string to
// avoid embedding raw combining marks in source code.
const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Último token do nome normalizado. */
export function surname(s: string): string {
  const norm = normalizeName(s);
  const parts = norm.split(' ');
  return parts[parts.length - 1] ?? '';
}
