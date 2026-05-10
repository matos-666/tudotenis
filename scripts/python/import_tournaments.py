"""
Import tournaments from Jeff Sackmann CSVs into Supabase.

Strategy:
- Group matches by (tourney_name, year) → 1 row per tournament
- Map Sackmann tourney_level → our category:
    ATP: G=slam, M=1000, A=500 (if known) or 250, C=challenger, D=davis_cup
    WTA: G=slam, PM/P/T1=1000, T2=500, I/T3=250, C=challenger
- Upsert tournaments by slug
- UPDATE matches.tournament_id linking each match to its tournament
"""
import os
import csv
import re
import json
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path

# ── ENV ──
def load_env(path):
    if not os.path.exists(path): return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

ROOT = Path(__file__).parent
load_env(str(ROOT.parent.parent / '.env.local'))
URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL', '').rstrip('/')
KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}

DATA_DIR = ROOT / 'data'
YEARS = list(range(2015, 2027))

# ── Known ATP 500s (used to distinguish from 250s when level=A) ──
ATP_500_PATTERNS = [
    r'\brotterdam\b', r'\babn amro\b',
    r'\brio\b', r'\brio de janeiro\b',
    r'\bdubai\b',
    r'\bacapulco\b', r'\bmexican open\b',
    r'\bbarcelona\b',
    r'\bqueen', r'\bqueens club\b', r"\bqueen's\b",
    r'\bhalle\b',
    r'\bhamburg\b',
    r'\bwashington\b',
    r'\bbeijing\b', r'\bchina open\b',
    r'\btokyo\b', r'\bjapan open\b',
    r'\bvienna\b', r'\bwien\b',
    r'\bbasel\b',
    r'\bdoha\b',
    r'\bmemphis\b',  # legacy 500
    r'\bvalencia\b',  # legacy 500
]

# Known WTA 500s
WTA_500_PATTERNS = [
    r'\brio\b', r'\bdubai\b', r'\bdoha\b',
    r'\bwashington\b', r'\bcharleston\b',
    r'\bstuttgart\b', r'\bmadrid premier\b',
    r'\bberlin\b', r'\beastbourne\b',
    r'\bzhengzhou\b', r'\bdc open\b',
    r'\bsan diego\b', r'\bguadalajara\b',
    r'\btokyo\b',
]

def is_500(name, tour):
    n = name.lower()
    patterns = ATP_500_PATTERNS if tour == 'atp' else WTA_500_PATTERNS
    return any(re.search(p, n) for p in patterns)

# ── Surface ──
def normalize_surface(s):
    s = (s or '').lower()
    if 'clay' in s: return 'clay'
    if 'grass' in s: return 'grass'
    if 'carpet' in s or 'indoor' in s: return 'indoor'
    return 'hard'

def surface_label(s):
    return {'clay': 'Saibro', 'hard': 'Hard', 'grass': 'Grama', 'indoor': 'Indoor'}.get(s, 'Hard')

# ── Category ──
def map_category(level, tour, name, draw_size):
    """Sackmann level → DB category."""
    L = (level or '').strip()
    if tour == 'atp':
        if L == 'G': return 'slam'
        if L == 'M': return '1000'
        if L == 'F': return 'finals'   # ATP Finals
        if L == 'A':
            if is_500(name, 'atp'): return '500'
            try:
                ds = int(draw_size or 0)
                if ds >= 48: return '500'
            except (ValueError, TypeError): pass
            return '250'
        if L == 'C': return 'challenger'
        if L == 'D': return 'davis_cup'
        return '250'
    else:  # wta
        if L == 'G': return 'slam'
        if L in ('P', 'PM', 'T1'): return '1000'
        if L == 'F': return 'finals'
        if L == 'T2': return '500'
        if L in ('T3', 'I'):
            if is_500(name, 'wta'): return '500'
            return '250'
        if L == 'C': return 'challenger'
        if L == 'D': return 'fed_cup'
        return '250'

# ── Slugify ──
def slugify(name):
    s = name.lower().strip()
    s = re.sub(r'[áàâãäå]', 'a', s)
    s = re.sub(r'[éèêë]', 'e', s)
    s = re.sub(r'[íìîï]', 'i', s)
    s = re.sub(r'[óòôõö]', 'o', s)
    s = re.sub(r'[úùûü]', 'u', s)
    s = re.sub(r"['\"`.]", '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return re.sub(r'-+', '-', s).strip('-')

# ── Country flag ──
COUNTRY_HINT = [
    ('australian open', 'au', '🇦🇺'),
    ('french open', 'fr', '🇫🇷'),
    ('roland garros', 'fr', '🇫🇷'),
    ('wimbledon', 'gb', '🇬🇧'),
    ('us open', 'us', '🇺🇸'),
    ('rome', 'it', '🇮🇹'),
    ('roma', 'it', '🇮🇹'),
    ('madrid', 'es', '🇪🇸'),
    ('monte carlo', 'mc', '🇲🇨'),
    ('miami', 'us', '🇺🇸'),
    ('indian wells', 'us', '🇺🇸'),
    ('bnp paribas', 'us', '🇺🇸'),
    ('canadian open', 'ca', '🇨🇦'),
    ('toronto', 'ca', '🇨🇦'),
    ('montreal', 'ca', '🇨🇦'),
    ('cincinnati', 'us', '🇺🇸'),
    ('shanghai', 'cn', '🇨🇳'),
    ('paris', 'fr', '🇫🇷'),
    ('rotterdam', 'nl', '🇳🇱'),
    ('rio', 'br', '🇧🇷'),
    ('dubai', 'ae', '🇦🇪'),
    ('acapulco', 'mx', '🇲🇽'),
    ('barcelona', 'es', '🇪🇸'),
    ('queens', 'gb', '🇬🇧'),
    ('halle', 'de', '🇩🇪'),
    ('hamburg', 'de', '🇩🇪'),
    ('washington', 'us', '🇺🇸'),
    ('beijing', 'cn', '🇨🇳'),
    ('tokyo', 'jp', '🇯🇵'),
    ('japan', 'jp', '🇯🇵'),
    ('vienna', 'at', '🇦🇹'),
    ('basel', 'ch', '🇨🇭'),
    ('doha', 'qa', '🇶🇦'),
    ('marrakech', 'ma', '🇲🇦'),
    ('estoril', 'pt', '🇵🇹'),
    ('munich', 'de', '🇩🇪'),
    ('geneva', 'ch', '🇨🇭'),
    ('lyon', 'fr', '🇫🇷'),
    ('stuttgart', 'de', '🇩🇪'),
    ('mallorca', 'es', '🇪🇸'),
    ('eastbourne', 'gb', '🇬🇧'),
    ('newport', 'us', '🇺🇸'),
    ('bastad', 'se', '🇸🇪'),
    ('umag', 'hr', '🇭🇷'),
    ('atlanta', 'us', '🇺🇸'),
    ('los cabos', 'mx', '🇲🇽'),
    ('kitzbuhel', 'at', '🇦🇹'),
    ('winston-salem', 'us', '🇺🇸'),
    ('chengdu', 'cn', '🇨🇳'),
    ('zhuhai', 'cn', '🇨🇳'),
    ('astana', 'kz', '🇰🇿'),
    ('nur-sultan', 'kz', '🇰🇿'),
    ('moscow', 'ru', '🇷🇺'),
    ('antwerp', 'be', '🇧🇪'),
    ('stockholm', 'se', '🇸🇪'),
    ('sofia', 'bg', '🇧🇬'),
    ('metz', 'fr', '🇫🇷'),
    ('san diego', 'us', '🇺🇸'),
    ('charleston', 'us', '🇺🇸'),
    ('bogota', 'co', '🇨🇴'),
    ('istanbul', 'tr', '🇹🇷'),
    ('rabat', 'ma', '🇲🇦'),
    ('strasbourg', 'fr', '🇫🇷'),
    ('birmingham', 'gb', '🇬🇧'),
    ('berlin', 'de', '🇩🇪'),
    ('san jose', 'us', '🇺🇸'),
    ('cleveland', 'us', '🇺🇸'),
    ('chicago', 'us', '🇺🇸'),
    ('seoul', 'kr', '🇰🇷'),
    ('zhengzhou', 'cn', '🇨🇳'),
    ('osaka', 'jp', '🇯🇵'),
    ('hua hin', 'th', '🇹🇭'),
    ('hobart', 'au', '🇦🇺'),
    ('auckland', 'nz', '🇳🇿'),
    ('brisbane', 'au', '🇦🇺'),
    ('adelaide', 'au', '🇦🇺'),
    ('linz', 'at', '🇦🇹'),
    ('luxembourg', 'lu', '🇱🇺'),
    ('cluj', 'ro', '🇷🇴'),
]

def location_country(name):
    n = name.lower()
    for hint, country, flag in COUNTRY_HINT:
        if hint in n:
            return (country, flag)
    return (None, None)

# ── Load CSVs ──
def load_csv(prefix):
    rows = []
    for year in YEARS:
        f = DATA_DIR / f'{prefix}_matches_{year}.csv'
        if not f.exists(): continue
        with open(f, encoding='utf-8') as fh:
            for row in csv.DictReader(fh):
                rows.append(row)
    return rows

# ── Supabase ──
def supa_request(path, method='GET', body=None, prefer=None, timeout=120):
    url = f"{URL}/rest/v1/{path}"
    headers = dict(H)
    if prefer: headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

# ── Main ──
def main():
    print("=" * 60)
    print("Import Tournaments from Sackmann CSVs")
    print("=" * 60)

    print("\n[1/4] Loading CSVs…")
    atp_rows = load_csv('atp')
    wta_rows = load_csv('wta')
    print(f"      ATP: {len(atp_rows):,} | WTA: {len(wta_rows):,}")

    # ── Group by (tourney_name, year, tour) ──
    print("\n[2/4] Grouping into tournaments…")
    tourns = {}  # key: (slug, year, tour) → tournament dict
    match_to_tourn = {}  # key: (date_iso, p1_slug, p2_slug) → tournament_slug+year

    def player_slug(name):
        return slugify(name) if name else None

    for tour, rows in [('atp', atp_rows), ('wta', wta_rows)]:
        for r in rows:
            tname = (r.get('tourney_name') or '').strip()
            tdate = (r.get('tourney_date') or '').strip()
            level = (r.get('tourney_level') or '').strip()
            surface = normalize_surface(r.get('surface', ''))
            draw_size = (r.get('draw_size') or '').strip()
            if not tname or len(tdate) != 8:
                continue
            year = int(tdate[:4])
            slug = f"{slugify(tname)}-{year}-{tour}"
            month = tdate[4:6]
            day = tdate[6:8]
            iso_date = f"{year}-{month}-{day}"

            if slug not in tourns:
                country, flag = location_country(tname)
                category = map_category(level, tour, tname, draw_size)
                tourns[slug] = {
                    'slug': slug,
                    'name': tname,
                    'full_name': tname,
                    'year': year,
                    'tour': tour,
                    'category': category,
                    'surface': surface,
                    'surface_label': surface_label(surface),
                    'location': tname,
                    'country': country,
                    'flag': flag,
                    'start_date': iso_date,
                    'end_date': iso_date,
                    'draw_size': draw_size or None,
                    'status': 'finished',
                }
            else:
                # Update end_date if later
                if iso_date > tourns[slug]['end_date']:
                    tourns[slug]['end_date'] = iso_date
                if iso_date < tourns[slug]['start_date']:
                    tourns[slug]['start_date'] = iso_date

            # Track for match-to-tournament linking
            wname = r.get('winner_name', '').strip()
            lname = r.get('loser_name', '').strip()
            if wname and lname:
                match_to_tourn[(iso_date, player_slug(wname), player_slug(lname))] = slug

    print(f"      {len(tourns):,} tournaments groups")

    # Stats
    cat_counts = defaultdict(int)
    for t in tourns.values():
        cat_counts[f"{t['tour']}-{t['category']}"] += 1
    print("      Distribution:")
    for cat, n in sorted(cat_counts.items(), key=lambda x: -x[1]):
        print(f"        {cat}: {n}")

    # ── Upsert tournaments ──
    print(f"\n[3/4] Upserting {len(tourns):,} tournaments…")
    rows = list(tourns.values())
    batch_size = 100
    total = len(rows)
    ok = 0
    for i in range(0, total, batch_size):
        batch = rows[i:i+batch_size]
        status, _ = supa_request(
            'tournaments?on_conflict=slug',
            method='POST',
            body=batch,
            prefer='resolution=merge-duplicates,return=minimal',
        )
        if status in (200, 201, 204):
            ok += len(batch)
        else:
            print(f"  Batch {i//batch_size+1}: status={status}")
        if (i//batch_size+1) % 5 == 0:
            print(f"  {ok:,}/{total:,}")
    print(f"  ✅ {ok}/{total} tournaments upserted")

    # ── Update matches.tournament_id ──
    print(f"\n[4/4] Linking matches to tournaments…")

    # Fetch tournament slug → id
    print("      Fetching tournament IDs…")
    tslug_to_id = {}
    offset = 0
    while True:
        status, body = supa_request(f"tournaments?select=id,slug&limit=1000&offset={offset}", method='GET')
        if status != 200: break
        items = json.loads(body)
        if not items: break
        for it in items:
            tslug_to_id[it['slug']] = it['id']
        if len(items) < 1000: break
        offset += 1000
    print(f"      {len(tslug_to_id):,} tournament IDs")

    # Fetch ALL matches in batches of 1000 to get id, date, player1_id, player2_id, winner_id
    # Then map to tournament via player slugs
    # Need slug→player_id mapping too
    print("      Fetching player slug→id mapping…")
    pslug_to_id = {}
    pid_to_slug = {}
    offset = 0
    while True:
        status, body = supa_request(f"players?select=id,slug&limit=1000&offset={offset}", method='GET')
        if status != 200: break
        items = json.loads(body)
        if not items: break
        for it in items:
            pslug_to_id[it['slug']] = it['id']
            pid_to_slug[it['id']] = it['slug']
        if len(items) < 1000: break
        offset += 1000
    print(f"      {len(pslug_to_id):,} players")

    # Now fetch matches and group updates by tournament
    print("      Fetching matches…")
    matches_to_update = defaultdict(list)  # tournament_id → [match_id]
    offset = 0
    fetched = 0
    while True:
        status, body = supa_request(
            f"matches?select=id,date,player1_id,player2_id,winner_id&limit=1000&offset={offset}",
            method='GET',
        )
        if status != 200: break
        items = json.loads(body)
        if not items: break
        for m in items:
            d = m.get('date')
            wid = m.get('winner_id') or m.get('player1_id')
            lid = m.get('player2_id') if wid == m.get('player1_id') else m.get('player1_id')
            wslug = pid_to_slug.get(wid)
            lslug = pid_to_slug.get(lid)
            if not d or not wslug or not lslug:
                continue
            tslug = match_to_tourn.get((d, wslug, lslug))
            if not tslug:
                # Try reversed
                tslug = match_to_tourn.get((d, lslug, wslug))
            if not tslug:
                continue
            tid = tslug_to_id.get(tslug)
            if tid:
                matches_to_update[tid].append(m['id'])
        fetched += len(items)
        if len(items) < 1000: break
        offset += 1000
    print(f"      {fetched:,} matches fetched, mapped to {len(matches_to_update):,} tournaments")

    # PATCH matches in bulk per tournament
    print("      Updating matches.tournament_id…")
    total_updated = 0
    for tid, match_ids in matches_to_update.items():
        # Use 'in' filter
        if not match_ids: continue
        # PostgREST supports id=in.(1,2,3,...). Split into chunks of 100 IDs.
        for j in range(0, len(match_ids), 200):
            chunk = match_ids[j:j+200]
            ids_str = ','.join(str(i) for i in chunk)
            status, _ = supa_request(
                f"matches?id=in.({ids_str})",
                method='PATCH',
                body={'tournament_id': tid},
                prefer='return=minimal',
            )
            if status in (200, 204):
                total_updated += len(chunk)
        if total_updated > 0 and total_updated % 5000 < 200:
            print(f"        {total_updated:,} matches linked")
    print(f"      ✅ {total_updated:,} matches linked")

    print("\n" + "=" * 60)
    print(f"DONE. Tournaments: {len(rows)} | Matches linked: {total_updated:,}")
    print("=" * 60)

if __name__ == '__main__':
    main()
