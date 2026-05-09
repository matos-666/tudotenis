"""
Import real pick history (524 picks) from tennis-elo project into Supabase.
Source: /Users/zezematos/tennis-elo/data/results_history.json
"""
import json
import re
import os
import sys
import urllib.request
import urllib.parse
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

# ── Slug + flag helpers ──
def slugify(name):
    s = name.lower().strip()
    s = re.sub(r'[áàâãäå]', 'a', s)
    s = re.sub(r'[éèêë]', 'e', s)
    s = re.sub(r'[íìîï]', 'i', s)
    s = re.sub(r'[óòôõö]', 'o', s)
    s = re.sub(r'[úùûü]', 'u', s)
    s = re.sub(r'[ç]', 'c', s)
    s = re.sub(r'[ñ]', 'n', s)
    s = re.sub(r"['\"`.]", '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s

def fetch_player_map():
    """slug → {id, name, flag}"""
    print("Loading players from DB…")
    out = {}
    offset = 0
    while True:
        url = f"{URL}/rest/v1/players?select=id,slug,name,flag&limit=1000&offset={offset}"
        req = urllib.request.Request(url, headers=H)
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.loads(r.read())
        if not rows: break
        for row in rows:
            out[row['slug']] = row
        if len(rows) < 1000: break
        offset += 1000
    print(f"  {len(out):,} players")
    return out

def normalize_grade(g):
    """A+, A, B, C → A, B, C (DB schema)"""
    if g in ('A+', 'A'): return 'A'
    if g == 'B': return 'B'
    if g == 'C': return 'C'
    return 'C'

def normalize_result(r):
    return {'WIN': 'win', 'LOSS': 'loss', 'VOID': 'void'}.get(r, None)

def normalize_surface(s):
    s = (s or '').lower()
    if 'clay' in s: return 'clay'
    if 'grass' in s: return 'grass'
    if 'indoor' in s or 'carpet' in s: return 'indoor'
    return 'hard'

def main():
    # 1. Load history
    src = '/Users/zezematos/tennis-elo/data/results_history.json'
    with open(src) as f:
        history = json.load(f)
    print(f"Loaded {len(history)} picks from {src}")

    # 2. Player map
    pmap = fetch_player_map()

    # 3. Transform
    rows = []
    skipped_no_player = 0
    matched = 0
    for tip_id, p in history.items():
        bet_player = p.get('bet_player', '').strip()
        opp = p.get('player2') if bet_player == p.get('player1') else p.get('player1')

        slug_bet = slugify(bet_player)
        slug_opp = slugify(opp) if opp else None

        # Lookup
        bet_p = pmap.get(slug_bet)
        opp_p = pmap.get(slug_opp) if slug_opp else None

        if not bet_p:
            skipped_no_player += 1
            continue
        matched += 1

        result = normalize_result(p.get('result'))
        if not result: continue

        date = p.get('date', '')
        settled_at = p.get('settled_at', '') or f"{date}T22:00:00"

        # Convert date → posted_at (during morning of the match day)
        posted_at = f"{date}T08:00:00Z"

        is_women = 'WTA' in (p.get('tournament', '') or '') or 'Women' in (p.get('tournament', '') or '')
        market = 'Vencedora' if is_women else 'Vencedor'

        try:
            odd = float(p.get('bet_odd', 0))
            stake = float(p.get('stake', 0))
            edge = float(p.get('edge', 0)) * 100  # 0.1937 → 19.37
            profit = float(p.get('profit', 0))
        except (ValueError, TypeError):
            continue

        rows.append({
            'player_id': bet_p['id'],
            'market': market,
            'selection': bet_p['name'],
            'odd': odd,
            'edge_pct': round(edge, 2),
            'grade': normalize_grade(p.get('grade')),
            'stake': stake,
            'result': result,
            'pl': round(profit, 2),
            'settled_at': settled_at,
            'posted_at': posted_at,
            'source': 'tennis_elo_legacy',
            'p1_name': bet_p['name'],
            'p2_name': (opp_p['name'] if opp_p else opp) or '–',
            'p1_flag': bet_p.get('flag'),
            'p2_flag': (opp_p.get('flag') if opp_p else None),
            'tournament_name': p.get('tournament'),
            'surface': normalize_surface(p.get('surface')),
        })

    print(f"\nMatched: {matched} | Skipped (player not in DB): {skipped_no_player}")
    print(f"Rows to insert: {len(rows)}")

    if not rows:
        print("Nothing to insert.")
        return

    # 4. Batch INSERT
    print("\nInserting picks…")
    batch_size = 100
    total = len(rows)
    ok = 0
    for i in range(0, total, batch_size):
        batch = rows[i:i+batch_size]
        body = json.dumps(batch).encode()
        req = urllib.request.Request(
            f"{URL}/rest/v1/picks",
            data=body, method='POST',
            headers={**H, 'Prefer': 'return=minimal'}
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.status in (200, 201, 204):
                    ok += len(batch)
                else:
                    print(f"  Batch {i//batch_size+1}: status {r.status}")
        except urllib.error.HTTPError as e:
            print(f"  Batch {i//batch_size+1}: HTTP {e.code} - {e.read()[:200].decode()}")
        if (i//batch_size+1) % 5 == 0:
            print(f"  {ok:,}/{total:,}")
    print(f"\n✅ {ok}/{total} picks inserted")

    # Stats
    wins = sum(1 for r in rows if r['result'] == 'win')
    losses = sum(1 for r in rows if r['result'] == 'loss')
    voids = sum(1 for r in rows if r['result'] == 'void')
    total_stake = sum(r['stake'] for r in rows)
    total_pl = sum(r['pl'] for r in rows)
    yield_pct = (total_pl/total_stake*100) if total_stake else 0
    win_rate = (wins/(wins+losses)*100) if (wins+losses) else 0
    print(f"\nStats:")
    print(f"  Picks: {len(rows)}")
    print(f"  W-L-V: {wins}-{losses}-{voids}")
    print(f"  Win rate: {win_rate:.1f}%")
    print(f"  Total stake: €{total_stake:.2f}")
    print(f"  Total P&L: €{total_pl:.2f}")
    print(f"  Yield: {yield_pct:.2f}%")

if __name__ == '__main__':
    main()
