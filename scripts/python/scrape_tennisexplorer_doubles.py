#!/usr/bin/env python3
"""
TennisExplorer doubles results scraper — backfill 2021-presente.

Fonte: tennisexplorer.com/results/?type={atp-double,wta-double}&year=YYYY&week=WW

Estratégia:
  - 1 request por (tour, ano, semana) = ~520 requests por tour
  - Delay 4s + headers realistas (passa Cloudflare como Oddschecker)
  - Save incremental por semana em CSV (resumable se rebentar a meio)
  - Hardcoded surface lookup pelos slugs de torneio mais comuns
    (clay swing, grass season, slams) — default hard

Output: scripts/python/data/te_doubles/{tour}_{year}_w{week:02d}.csv

Schema CSV:
  match_id, date, tour, tournament_slug, tournament_name, surface,
  t1_p1_slug, t1_p1_name, t1_p2_slug, t1_p2_name,
  t2_p1_slug, t2_p1_name, t2_p2_slug, t2_p2_name,
  winner_team, t1_sets, t2_sets, set_scores, t1_odd, t2_odd
"""
import urllib.request
import urllib.error
import csv
import time
import re
import sys
import argparse
from pathlib import Path
from datetime import date, timedelta

# ── Config ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
OUT_DIR = ROOT / 'data' / 'te_doubles'
OUT_DIR.mkdir(parents=True, exist_ok=True)

DELAY_SECONDS = 4.0
RETRY_DELAY_SECONDS = 60.0
MAX_RETRIES = 3

HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,'
        'image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    # Aceitar gzip — descompacta manualmente abaixo
    'Accept-Encoding': 'gzip',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
}

# Tournament slug → surface. Lookup é case-insensitive contra a 1ª parte
# do URL TE (/stuttgart/2024/atp-men → "stuttgart").
SURFACE_MAP = {
    # Grass
    'wimbledon': 'grass', 'halle': 'grass', 'queens-club': 'grass',
    'queens': 'grass', 'eastbourne': 'grass', 'stuttgart': 'grass',
    'mallorca': 'grass', 'newport': 'grass', 'hertogenbosch': 'grass',
    's-hertogenbosch': 'grass', 'birmingham': 'grass', 'nottingham': 'grass',
    'bad-homburg': 'grass',
    # Clay
    'roland-garros': 'clay', 'french-open': 'clay',
    'monte-carlo': 'clay', 'monte-carlo-masters': 'clay',
    'madrid': 'clay', 'madrid-open': 'clay',
    'rome': 'clay', 'italian-open': 'clay',
    'barcelona': 'clay', 'hamburg': 'clay', 'umag': 'clay',
    'bastad': 'clay', 'gstaad': 'clay', 'kitzbuhel': 'clay',
    'estoril': 'clay', 'munich': 'clay', 'geneva': 'clay',
    'lyon': 'clay', 'rio-de-janeiro': 'clay', 'rio': 'clay',
    'buenos-aires': 'clay', 'santiago': 'clay', 'cordoba': 'clay',
    'sao-paulo': 'clay', 'marrakech': 'clay', 'houston': 'clay',
    'palermo': 'clay', 'cagliari': 'clay', 'parma': 'clay',
    'belgrade': 'clay', 'banja-luka': 'clay', 'sardinia': 'clay',
    'strasbourg': 'clay', 'charleston': 'clay', 'rabat': 'clay',
    'bogota': 'clay', 'prague': 'clay', 'cluj-napoca': 'clay',
    'iasi': 'clay', 'lausanne': 'clay', 'jiangxi': 'clay',
    'warsaw': 'clay', 'budapest': 'clay', 'lugano': 'clay',
    # Indoor (treated as hard for ELO)
    'paris': 'hard', 'paris-masters': 'hard',
    'rotterdam': 'hard', 'marseille': 'hard', 'metz': 'hard',
    'antwerp': 'hard', 'stockholm': 'hard', 'sofia': 'hard',
    'basel': 'hard', 'vienna': 'hard',
    'turin': 'hard', 'atp-finals': 'hard',
    'wta-finals': 'hard',
    'st-petersburg': 'hard', 'moscow': 'hard',
    'milan': 'hard', 'astana': 'hard', 'tel-aviv': 'hard',
    # Default surface (hard) — outdoor hard normalmente
}


def url_for_day(tour: str, d: date) -> str:
    """
    URL por dia: TennisExplorer ignora silenciosamente o parâmetro `week=`
    (todas as semanas devolvem a mesma página default). Apenas `month=&day=`
    filtra correctamente. Por isso iteramos dia-a-dia.
    """
    return (
        f'https://www.tennisexplorer.com/results/'
        f'?type={tour}&year={d.year}&month={d.month:02d}&day={d.day:02d}'
    )


def fetch(url: str, delay: float = DELAY_SECONDS) -> str:
    time.sleep(delay)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        # Descompacta gzip se a resposta vier comprimida
        if resp.headers.get('Content-Encoding', '').lower() == 'gzip':
            import gzip
            raw = gzip.decompress(raw)
        # Decode (TE serve UTF-8 mas o fallback é ISO-8859-1)
        try:
            return raw.decode('utf-8')
        except UnicodeDecodeError:
            return raw.decode('iso-8859-1', errors='replace')


# ── Parser ────────────────────────────────────────────────────────────────

# Cada tournament block: <table class="result"> ... <tr class="head flags">
# com link `/<slug>/<year>/atp-men/?type=double` ou similar.
TABLE_RE = re.compile(r'<table class="result"[^>]*>(.*?)</table>', re.S)
HEAD_RE = re.compile(
    r'<tr class="head flags">\s*<td class="t-name"[^>]*>'
    r'<a href="(/[^"/]+/[^"]+)">(.*?)</a>',
    re.S,
)


def strip_tags(s: str) -> str:
    """Strip HTML tags + decode &nbsp;, etc."""
    s = re.sub(r'<[^>]+>', ' ', s)
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&')
    return re.sub(r'\s+', ' ', s).strip()
TEAM_LINK_RE = re.compile(r'<a [^>]*?href="(/doubles-team/[^"]+)"[^>]*>([^<]+)</a>')
MATCH_ID_RE = re.compile(r'/match-detail/\?id=(\d+)')


def parse_team_slug_pair(href: str) -> tuple[str, str]:
    """`/doubles-team/matos-33d92/melo-4731d/` → ('matos-33d92', 'melo-4731d')"""
    m = re.match(r'/doubles-team/([^/]+)/([^/]+)/?', href)
    if not m:
        return ('', '')
    return (m.group(1), m.group(2))


def split_team_name(name: str) -> tuple[str, str]:
    """'Matos R. / Melo M.' → ('Matos R.', 'Melo M.')"""
    parts = [p.strip() for p in name.split('/')]
    return (parts[0] if parts else '', parts[1] if len(parts) > 1 else '')


def surface_from_tslug(t_url: str) -> str:
    """Extract tournament-slug from URL and lookup surface."""
    m = re.match(r'/([^/]+)/', t_url)
    if not m:
        return 'hard'
    slug = m.group(1).lower()
    return SURFACE_MAP.get(slug, 'hard')


def parse_date_from_page(html: str, default_year: int) -> str:
    """
    Extract date from page nav. Tries multiple formats:
      "06. 2024" with day, "11. 06. 2024", etc.
    Fallback: returns YYYY-01-01 if not found.
    """
    # "11. 06. 2024" pattern
    m = re.search(r'(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})', html[:5000])
    if m:
        d, mo, y = m.groups()
        return f'{y}-{int(mo):02d}-{int(d):02d}'
    return f'{default_year}-01-01'


def parse_week(html: str, tour: str, default_year: int) -> list[dict]:
    """Parse one week's results page into list of match dicts.

    Estrutura TE: UMA `<table class="result">` contém múltiplos torneios.
    Cada torneio é delimitado por `<tr class="head flags">`. Os matches
    estão em pares de rows: rN (team winner) + rNb (team loser).

    Iteramos tudo sequencialmente, mantendo o "torneio actual" à medida
    que vamos andando. Pairing por ID prefix (rN ↔ rNb) para ser
    robusto a ordem.
    """
    out: list[dict] = []
    default_date = parse_date_from_page(html, default_year)

    # Pega o body da primeira tabela (geralmente é onde estão os matches)
    body = None
    for table_match in TABLE_RE.finditer(html):
        candidate = table_match.group(1)
        # Skip tabelas como "Main tournaments" (overview); queremos a que tem
        # head flags + rows com class one/two.
        if '<tr class="head flags">' in candidate and 'doubles-team' in candidate:
            body = candidate
            break
    if body is None:
        return out

    # Iteramos por TRs todas (head flags + result rows) por ordem no DOM.
    # Cada head flags muda o "current_tournament".
    # Cada par (rN, rNb) é um match.
    current_tour_info: dict | None = None

    # Sequência: split body por <tr>...</tr> e identifica tipo
    tr_re = re.compile(r'<tr([^>]*)>(.*?)</tr>', re.S)
    pending_first: dict | None = None  # row 1 of match (winner team)

    for tr in tr_re.finditer(body):
        attrs = tr.group(1)
        inner = tr.group(2)

        # Tournament header?
        if 'class="head flags"' in attrs:
            h_m = re.search(
                r'<td class="t-name"[^>]*>\s*<a href="(/[^"/]+/[^"]+)">(.*?)</a>',
                inner, re.S,
            )
            if h_m:
                t_url = h_m.group(1)
                t_name = strip_tags(h_m.group(2))
                t_name = re.sub(r'\s*\(\d+\)\s*$', '', t_name)
                t_slug_m = re.match(r'/([^/]+)/', t_url)
                current_tour_info = {
                    'tournament_slug': t_slug_m.group(1) if t_slug_m else '',
                    'tournament_name': t_name,
                    'surface': surface_from_tslug(t_url),
                }
            pending_first = None
            continue

        # Result row?
        id_m = re.match(r'.*?id="r(\d+)([a-z]?)"', attrs)
        if not id_m:
            continue
        if not re.search(r'class="[^"]*\b(?:one|two)\b[^"]*"', attrs):
            continue

        row_id = id_m.group(1)
        suffix = id_m.group(2)

        if current_tour_info is None:
            continue

        if suffix == '':
            # Row 1 (winner / first team)
            pending_first = {
                'row_id': row_id,
                'inner': inner,
            }
        elif suffix == 'b' and pending_first and pending_first['row_id'] == row_id:
            # Row 2 (loser / second team) — emit match
            r1 = pending_first['inner']
            r2 = inner
            t1_link = TEAM_LINK_RE.search(r1)
            t2_link = TEAM_LINK_RE.search(r2)
            if not t1_link or not t2_link:
                continue

            t1_href = t1_link.group(1)
            t1_name = t1_link.group(2).strip()
            t2_href = t2_link.group(1)
            t2_name = t2_link.group(2).strip()

            t1_p1_slug, t1_p2_slug = parse_team_slug_pair(t1_href)
            t2_p1_slug, t2_p2_slug = parse_team_slug_pair(t2_href)
            t1_p1_name, t1_p2_name = split_team_name(t1_name)
            t2_p1_name, t2_p2_name = split_team_name(t2_name)

            # Result column (sets won) — find within first 800 chars of row
            t1_result_m = re.search(r'<td class="result">(\d+)</td>', r1)
            t2_result_m = re.search(r'<td class="result">(\d+)</td>', r2)
            if not t1_result_m or not t2_result_m:
                continue
            t1_sets = int(t1_result_m.group(1))
            t2_sets = int(t2_result_m.group(1))

            # Set-by-set scores (consecutive <td class="score">N</td>)
            t1_scores = re.findall(r'<td class="score">([^<]*)</td>', r1)
            t2_scores = re.findall(r'<td class="score">([^<]*)</td>', r2)
            # Clean &nbsp; e join "6-3 4-6 10-7" estilo
            def clean(s: str) -> str:
                s = s.replace('&nbsp;', '').strip()
                return s if s and s.isdigit() else ''
            sets_pairs = []
            for a, b in zip(t1_scores, t2_scores):
                ca, cb = clean(a), clean(b)
                if ca and cb:
                    sets_pairs.append(f'{ca}-{cb}')
            set_scores = ' '.join(sets_pairs)

            # Odds: ambas (coursew + course) na row 1 via rowspan=2.
            # coursew = winner odd, course = loser odd.
            odds_in_r1 = re.findall(
                r'<td class="course[w]?"[^>]*>([\d.]+)</td>', r1)
            t1_odd = float(odds_in_r1[0]) if len(odds_in_r1) >= 1 else None
            t2_odd = float(odds_in_r1[1]) if len(odds_in_r1) >= 2 else None

            # Match ID (link to detail)
            mid_m = MATCH_ID_RE.search(r1) or MATCH_ID_RE.search(r2)
            match_id = mid_m.group(1) if mid_m else ''

            # Winner team
            winner_team = 1 if t1_sets > t2_sets else 2 if t2_sets > t1_sets else 0

            out.append({
                'match_id': match_id,
                'date': default_date,
                'tour': tour,
                'tournament_slug': current_tour_info['tournament_slug'],
                'tournament_name': current_tour_info['tournament_name'],
                'surface': current_tour_info['surface'],
                't1_p1_slug': t1_p1_slug,
                't1_p1_name': t1_p1_name,
                't1_p2_slug': t1_p2_slug,
                't1_p2_name': t1_p2_name,
                't2_p1_slug': t2_p1_slug,
                't2_p1_name': t2_p1_name,
                't2_p2_slug': t2_p2_slug,
                't2_p2_name': t2_p2_name,
                'winner_team': winner_team,
                't1_sets': t1_sets,
                't2_sets': t2_sets,
                'set_scores': set_scores,
                't1_odd': t1_odd if t1_odd else '',
                't2_odd': t2_odd if t2_odd else '',
            })
            pending_first = None
    return out


# ── Main loop ─────────────────────────────────────────────────────────────

CSV_FIELDS = [
    'match_id', 'date', 'tour', 'tournament_slug', 'tournament_name', 'surface',
    't1_p1_slug', 't1_p1_name', 't1_p2_slug', 't1_p2_name',
    't2_p1_slug', 't2_p1_name', 't2_p2_slug', 't2_p2_name',
    'winner_team', 't1_sets', 't2_sets', 'set_scores', 't1_odd', 't2_odd',
]


def save_day(matches: list[dict], tour: str, d: date):
    out_file = OUT_DIR / f'{tour}_{d.isoformat()}.csv'
    with open(out_file, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for m in matches:
            w.writerow(m)


def scrape_range_days(tour: str, start_d: date, end_d: date) -> None:
    """Iterate dia-a-dia, resuming if files exist."""
    cur = start_d
    total_matches = 0
    days_done = 0
    while cur <= end_d:
        out_file = OUT_DIR / f'{tour}_{cur.isoformat()}.csv'
        if out_file.exists():
            cur += timedelta(days=1)
            continue

        url = url_for_day(tour, cur)
        attempts = 0
        while attempts < MAX_RETRIES:
            try:
                print(f'[fetch] {tour} {cur.isoformat()}…', end=' ', flush=True)
                html = fetch(url)
                matches = parse_week(html, tour, cur.year)
                # Set date to scraped day (override the page's date parse fallback)
                day_iso = cur.isoformat()
                for m in matches:
                    m['date'] = day_iso
                save_day(matches, tour, cur)
                total_matches += len(matches)
                days_done += 1
                print(f'→ {len(matches)} matches  (total: {total_matches:,} in {days_done} days)')
                break
            except urllib.error.HTTPError as e:
                attempts += 1
                if e.code in (403, 429, 503):
                    print(f'⚠ HTTP {e.code} — sleep {RETRY_DELAY_SECONDS}s, retry {attempts}/{MAX_RETRIES}')
                    time.sleep(RETRY_DELAY_SECONDS)
                else:
                    print(f'❌ HTTP {e.code}')
                    break
            except Exception as e:
                attempts += 1
                print(f'⚠ {e!s} — sleep {RETRY_DELAY_SECONDS}s, retry {attempts}/{MAX_RETRIES}')
                time.sleep(RETRY_DELAY_SECONDS)

        cur += timedelta(days=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tour', choices=['atp-double', 'wta-double', 'both'],
                    default='both')
    ap.add_argument('--start', default='2021-01-01',
                    help='YYYY-MM-DD ISO date (default 2021-01-01)')
    ap.add_argument('--end', default=None,
                    help='YYYY-MM-DD ISO date (default = hoje)')
    ap.add_argument('--test', action='store_true',
                    help='Só 1 dia de teste e sai')
    args = ap.parse_args()

    def parse_d(s: str) -> date:
        return date.fromisoformat(s)
    start_d = parse_d(args.start)
    end_d = parse_d(args.end) if args.end else date.today()
    if args.test:
        end_d = start_d

    tours = ['atp-double', 'wta-double'] if args.tour == 'both' else [args.tour]
    for tour in tours:
        print(f'\n=== {tour} ({start_d} → {end_d}) ===')
        scrape_range_days(tour, start_d, end_d)
    print('\nDONE.')


if __name__ == '__main__':
    main()
