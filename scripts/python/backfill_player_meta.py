#!/usr/bin/env python3
"""
Backfill players.birth_date + players.height_cm a partir dos CSVs Jeff
Sackmann (atp_players.csv + wta_players.csv).

Match strategy: por nome completo normalizado (sem acentos, lowercase).
Players com ambíguos por nome (raro) ficam para fixing manual.
"""
import os, sys, csv, json, urllib.request, urllib.error, unicodedata, re
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent

def load_env(p):
    if not os.path.exists(p): return
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

load_env(str(ROOT.parent.parent / '.env.local'))
URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL', '').rstrip('/')
KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
if not URL or not KEY:
    sys.exit('Missing env vars')
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}


def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))

def norm(s):
    return re.sub(r'[^a-z]', '', strip_accents(s).lower())


def parse_dob(s):
    """'19850127' -> '1985-01-27' (ISO date). Devolve None se inválido."""
    if not s or len(s) < 8: return None
    try:
        y, m, d = int(s[:4]), int(s[4:6]), int(s[6:8])
        if y < 1930 or y > 2015 or m < 1 or m > 12 or d < 1 or d > 31:
            return None
        return f'{y:04d}-{m:02d}-{d:02d}'
    except Exception:
        return None


def load_sackmann_players():
    """Devolve dict norm_name -> {dob, height, hand, ioc, tour}."""
    out = {}
    for tour, fname in [('atp', 'atp_players.csv'), ('wta', 'wta_players.csv')]:
        path = ROOT / 'data' / fname
        if not path.exists():
            print(f'  ⚠ {path} not found')
            continue
        with open(path, encoding='utf-8') as f:
            for row in csv.DictReader(f):
                name = f"{row.get('name_first','').strip()} {row.get('name_last','').strip()}".strip()
                if not name: continue
                key = norm(name)
                if key in out:
                    # Collision — keep first (older player; newer would overwrite)
                    continue
                out[key] = {
                    'name': name,
                    'tour': tour,
                    'dob': parse_dob(row.get('dob', '')),
                    'height': int(row.get('height') or 0) or None,
                    'hand': (row.get('hand') or '').strip()[:1] or None,
                    'ioc': (row.get('ioc') or '').strip()[:3] or None,
                }
        print(f'  loaded {len(out):,} players so far ({tour})')
    return out


def fetch_db_players():
    """Devolve list of {id, slug, name, tour, birth_date, height_cm, hand, country}."""
    out = []
    offset = 0
    page = 1000
    while True:
        url = f'{URL}/rest/v1/players?select=id,slug,name,tour,birth_date,height_cm,hand,country&limit={page}&offset={offset}'
        req = urllib.request.Request(url, headers=H)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        out.extend(data)
        if len(data) < page: break
        offset += page
    return out


def patch_player(pid, patch):
    url = f'{URL}/rest/v1/players?id=eq.{pid}'
    req = urllib.request.Request(
        url, data=json.dumps(patch).encode(),
        headers={**H, 'Prefer': 'return=minimal'},
        method='PATCH',
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status


def main():
    print('[1/3] Loading Sackmann player CSVs…')
    sack = load_sackmann_players()
    print(f'  total Sackmann players: {len(sack):,}')

    print('\n[2/3] Loading DB players…')
    db_players = fetch_db_players()
    print(f'  DB players: {len(db_players):,}')

    print('\n[3/3] Matching + patching…')
    matched = no_match = skipped = updated = failed = 0
    by_field = defaultdict(int)

    for p in db_players:
        key = norm(p['name'])
        sp = sack.get(key)
        if not sp:
            no_match += 1
            continue
        matched += 1

        # Skip if all fields already populated
        patch = {}
        if not p.get('birth_date') and sp['dob']:
            patch['birth_date'] = sp['dob']
            by_field['birth_date'] += 1
        if not p.get('height_cm') and sp['height']:
            patch['height_cm'] = sp['height']
            by_field['height_cm'] += 1
        if not p.get('hand') and sp['hand']:
            patch['hand'] = sp['hand']
            by_field['hand'] += 1
        if not p.get('country') and sp['ioc']:
            patch['country'] = sp['ioc']
            by_field['country'] += 1

        if not patch:
            skipped += 1
            continue

        try:
            patch_player(p['id'], patch)
            updated += 1
            if updated % 200 == 0:
                print(f'  {updated:,}/{matched:,} updated')
        except Exception as e:
            failed += 1
            if failed <= 5:
                print(f'  ⚠ id={p["id"]} ({p["name"]}): {e}')

    print(f'\n✅ Done')
    print(f'   Matched: {matched:,} / {len(db_players):,}')
    print(f'   Updated: {updated:,}  ·  Skipped (already populated): {skipped:,}')
    print(f'   No match: {no_match:,}  ·  Failed: {failed}')
    print(f'   By field:')
    for f, c in by_field.items(): print(f'     {f}: +{c}')


if __name__ == '__main__':
    main()
