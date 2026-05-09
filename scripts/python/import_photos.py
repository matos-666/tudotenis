"""
Import player photos from Wikipedia API.
Uses pageimages prop (returns infobox image — usually a clean headshot).

Strategy:
  1. Fetch all active players from Supabase (top 500 ATP + 500 WTA)
  2. For each, query Wikipedia: try "Name", then "Name (tennis)", "Name (tennis player)"
  3. Extract original image URL from response
  4. UPDATE players.photo_url

Rate-limited to 1 req/sec to respect Wikipedia ToS.
"""
import os
import time
import json
import urllib.request
import urllib.parse
import urllib.error
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

UA = "TudoTenis/1.0 (https://tudotenis.com; contact@tudotenis.com) Python-urllib"

# ── Supabase ──
def fetch_players():
    """Top 500 active ATP + 500 active WTA, sem photo ainda."""
    out = []
    offset = 0
    while True:
        url = (
            f"{URL}/rest/v1/players?"
            f"active=eq.true"
            f"&select=id,slug,name,tour,photo_url"
            f"&order=elo_overall.desc"
            f"&limit=1000&offset={offset}"
        )
        req = urllib.request.Request(url, headers=H)
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.loads(r.read())
        if not rows: break
        out.extend(rows)
        if len(rows) < 1000: break
        offset += 1000
    return out

def update_photo(pid, url):
    body = json.dumps({'photo_url': url}).encode()
    req = urllib.request.Request(
        f"{URL}/rest/v1/players?id=eq.{pid}",
        data=body, method='PATCH',
        headers={**H, 'Prefer': 'return=minimal'},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status in (200, 204)
    except urllib.error.HTTPError:
        return False

# ── Wikipedia API ──
def wiki_image(title):
    """
    Returns image URL or None.
    Uses pageimages action: returns the "lead image" (infobox photo).
    """
    params = {
        'action': 'query',
        'prop': 'pageimages',
        'format': 'json',
        'piprop': 'original',
        'titles': title,
        'redirects': 1,
    }
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError):
        return None
    pages = data.get('query', {}).get('pages', {})
    for _, page in pages.items():
        if 'missing' in page:
            return None
        orig = page.get('original')
        if orig and orig.get('source'):
            return orig['source']
    return None

def find_photo(name):
    """Try multiple title variants until one returns an image."""
    variants = [
        name,
        f"{name} (tennis)",
        f"{name} (tennis player)",
    ]
    for v in variants:
        u = wiki_image(v)
        if u:
            return u
        time.sleep(0.3)
    return None

# ── Main ──
def main():
    print("=" * 60)
    print("Import player photos via Wikipedia API")
    print("=" * 60)

    print("\nLoading active players…")
    players = fetch_players()
    print(f"  {len(players)} players")

    todo = [p for p in players if not p.get('photo_url')]
    print(f"  {len(todo)} sem photo ainda")

    found = 0
    notfound = 0
    failed = 0

    print("\nProcessing… (rate-limited ~1 req/sec)")
    for i, p in enumerate(todo):
        url = find_photo(p['name'])
        if url:
            ok = update_photo(p['id'], url)
            if ok:
                found += 1
                marker = '✅'
            else:
                failed += 1
                marker = '⚠'
        else:
            notfound += 1
            marker = '❌'

        if (i + 1) % 25 == 0 or i < 5:
            print(f"  [{i+1}/{len(todo)}] {marker} {p['name']:30s} → {(url or 'no photo')[:80]}")

        # Rate limit: 1 req per second
        time.sleep(1.0)

    print("\n" + "=" * 60)
    print(f"DONE. Found: {found} | Not found: {notfound} | Failed: {failed}")
    print("=" * 60)

if __name__ == '__main__':
    main()
