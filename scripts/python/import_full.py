"""
TudoTénis · Import COMPLETO (A+B+C)
=====================================
A. Importa matches table (59k jogos Jeff Sackmann 2015-2025)
B. Popula elo_history (snapshots mensais)
C. Expande para top 500 ATP + 500 WTA + jogadores de todos os matches

Run:
  cd /Users/zezematos/tudotenis/scripts/python
  python3 import_full.py
"""

import os
import csv
import re
import json
import sys
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path
from datetime import datetime

# ── ENV ───────────────────────────────────────────────────────────────────
def load_env(path):
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

ROOT = Path(__file__).parent
load_env(str(ROOT.parent.parent / '.env.local'))

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing Supabase env vars")
    sys.exit(1)

DATA_DIR = ROOT / 'data'
YEARS = list(range(2015, 2026))

# ── Supabase REST ─────────────────────────────────────────────────────────
def supa_request(path, method='GET', body=None, prefer=None, timeout=120):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }
    if prefer:
        headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        print(f"  HTTP {e.code} {method} {path}: {body}")
        return e.code, body.encode()

def upsert_batch(table, rows, on_conflict, batch_size=100, label=''):
    """Upsert rows in batches with progress."""
    total = len(rows)
    if total == 0:
        print(f"  {label}: 0 rows, skipping")
        return
    n_batches = (total - 1) // batch_size + 1
    ok = 0
    for i in range(0, total, batch_size):
        batch = rows[i:i + batch_size]
        status, _ = supa_request(
            f"{table}?on_conflict={on_conflict}",
            method='POST',
            body=batch,
            prefer='resolution=merge-duplicates,return=minimal',
        )
        if status in (200, 201, 204):
            ok += len(batch)
        else:
            print(f"  ⚠ Batch {i//batch_size+1}/{n_batches} failed (status={status})")
        if (i // batch_size + 1) % 10 == 0 or (i // batch_size + 1) == n_batches:
            print(f"  {label}: {ok:,}/{total:,} ({(i//batch_size+1)}/{n_batches} batches)")
    print(f"  {label}: ✅ {ok:,}/{total:,}")

def insert_batch(table, rows, batch_size=500, label=''):
    """Plain INSERT (não merge)."""
    total = len(rows)
    if total == 0:
        return
    n_batches = (total - 1) // batch_size + 1
    ok = 0
    for i in range(0, total, batch_size):
        batch = rows[i:i + batch_size]
        status, _ = supa_request(
            table, method='POST', body=batch, prefer='return=minimal',
        )
        if status in (200, 201, 204):
            ok += len(batch)
        if (i // batch_size + 1) % 10 == 0 or (i // batch_size + 1) == n_batches:
            print(f"  {label}: {ok:,}/{total:,}")
    print(f"  {label}: ✅ {ok:,}/{total:,}")

def fetch_all_players_map():
    """Fetch all players → returns dict slug → id."""
    mapping = {}
    offset = 0
    page = 1000
    while True:
        status, body = supa_request(
            f"players?select=id,slug&limit={page}&offset={offset}",
            method='GET',
        )
        if status != 200:
            break
        rows = json.loads(body)
        if not rows:
            break
        for r in rows:
            mapping[r['slug']] = r['id']
        if len(rows) < page:
            break
        offset += page
    return mapping

# ── ELO model ─────────────────────────────────────────────────────────────
INIT_ELO = 1500

def k_factor(round_, level):
    base = 32
    level_mult = {'G': 1.4, 'M': 1.2, 'A': 1.0, 'C': 0.85, 'D': 0.7}.get(level, 1.0)
    round_mult = {'F': 1.3, 'SF': 1.15, 'QF': 1.1, 'R16': 1.0, 'R32': 0.95,
                  'R64': 0.9, 'R128': 0.85}.get(round_, 1.0)
    return base * level_mult * round_mult

def expected_score(elo_a, elo_b):
    return 1.0 / (1.0 + 10 ** ((elo_b - elo_a) / 400))

# ── Slugify ───────────────────────────────────────────────────────────────
def slugify(name):
    if not name:
        return None
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

# ── Country flag ──────────────────────────────────────────────────────────
IOC_TO_ISO2 = {
    'ARG':'AR','AUS':'AU','AUT':'AT','BLR':'BY','BRA':'BR','CAN':'CA','CHI':'CL',
    'CHN':'CN','CRO':'HR','CZE':'CZ','DEN':'DK','ESP':'ES','FIN':'FI','FRA':'FR',
    'GBR':'GB','GER':'DE','GRE':'GR','HUN':'HU','IND':'IN','ISR':'IL','ITA':'IT',
    'JPN':'JP','KAZ':'KZ','KOR':'KR','LAT':'LV','LTU':'LT','MEX':'MX','NED':'NL',
    'NOR':'NO','POL':'PL','POR':'PT','RSA':'ZA','RUS':'RU','SLO':'SI','SRB':'RS',
    'SUI':'CH','SVK':'SK','SWE':'SE','TPE':'TW','TUN':'TN','UKR':'UA','URU':'UY',
    'USA':'US','UZB':'UZ','VEN':'VE','BUL':'BG','BIH':'BA','COL':'CO','EST':'EE',
    'BEL':'BE','EGY':'EG','ARM':'AM','ROU':'RO','GEO':'GE','BAR':'BB','PER':'PE',
    'PAR':'PY','BOL':'BO','ECU':'EC','CYP':'CY','TUR':'TR','NZL':'NZ','IRL':'IE',
    'LUX':'LU','MON':'MC','IRI':'IR','INA':'ID','PHI':'PH','THA':'TH','MAR':'MA',
    'ALG':'DZ','KSA':'SA','QAT':'QA','UAE':'AE','SGP':'SG',
}
def country_to_flag(ioc):
    if not ioc or len(ioc) != 3:
        return None
    iso2 = IOC_TO_ISO2.get(ioc.upper())
    if not iso2:
        return None
    return ''.join(chr(ord(c) - ord('A') + 0x1F1E6) for c in iso2)

# ── Surface mapping ───────────────────────────────────────────────────────
def normalize_surface(s):
    if not s:
        return 'hard'
    s = s.lower().strip()
    if 'clay' in s: return 'clay'
    if 'grass' in s: return 'grass'
    if 'carpet' in s or 'indoor' in s: return 'indoor'
    return 'hard'

# ── Load CSVs ─────────────────────────────────────────────────────────────
def load_matches(prefix):
    out = []
    for year in YEARS:
        f = DATA_DIR / f'{prefix}_matches_{year}.csv'
        if not f.exists():
            continue
        with open(f, encoding='utf-8') as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                out.append(row)
    out.sort(key=lambda r: (r.get('tourney_date', ''), r.get('match_num', '0')))
    return out

# ── Process tour ──────────────────────────────────────────────────────────
def process_tour(matches, tour, snapshot_dates):
    """
    Returns (players_dict, match_records, elo_snapshots).
      players_dict[slug] = {name, country, flag, tour, ELOs, ...}
      match_records = list of match dicts (with slug refs)
      elo_snapshots = list of {date, slug, elos}
    """
    players = {}
    elo_o = defaultdict(lambda: INIT_ELO)
    elo_s = defaultdict(lambda: defaultdict(lambda: INIT_ELO))
    games_played = defaultdict(int)
    last_match_date = {}
    wins_l5 = defaultdict(list)

    match_records = []
    elo_snapshots = []
    next_snapshot_idx = 0

    print(f"  Processing {len(matches):,} {tour.upper()} matches…")

    for m in matches:
        try:
            wname = m.get('winner_name', '').strip()
            lname = m.get('loser_name', '').strip()
            wioc = m.get('winner_ioc', '').strip()
            lioc = m.get('loser_ioc', '').strip()
            surface_raw = m.get('surface', '').strip() or 'Hard'
            round_ = m.get('round', '').strip()
            level = m.get('tourney_level', '').strip()
            date = m.get('tourney_date', '').strip()
            score = m.get('score', '').strip()
            best_of = m.get('best_of', '').strip()
            minutes = m.get('minutes', '').strip()
            tname = m.get('tourney_name', '').strip()
        except KeyError:
            continue
        if not wname or not lname or not date:
            continue

        wslug = slugify(wname)
        lslug = slugify(lname)
        if not wslug or not lslug:
            continue

        # Track players
        for slug, name, ioc in [(wslug, wname, wioc), (lslug, lname, lioc)]:
            if slug not in players:
                players[slug] = {
                    'slug': slug,
                    'tour': tour,
                    'name': name,
                    'country': ioc,
                    'flag': country_to_flag(ioc),
                    'birth_date': None,
                    'height_cm': None,
                    'hand': None,
                }

        # Player extras
        try:
            if m.get('winner_ht') and not players[wslug].get('height_cm'):
                v = m['winner_ht'].strip()
                if v:
                    players[wslug]['height_cm'] = int(float(v))
            if m.get('loser_ht') and not players[lslug].get('height_cm'):
                v = m['loser_ht'].strip()
                if v:
                    players[lslug]['height_cm'] = int(float(v))
            for slug, key in [(wslug, 'winner_hand'), (lslug, 'loser_hand')]:
                hand = (m.get(key) or '').strip()
                if hand == 'R': players[slug]['hand'] = 'right'
                elif hand == 'L': players[slug]['hand'] = 'left'
        except (ValueError, KeyError):
            pass

        # K-factor
        K = k_factor(round_, level)
        # ELO before
        elo_w_before = elo_o[wslug]
        elo_l_before = elo_o[lslug]
        ew = expected_score(elo_w_before, elo_l_before)
        elo_w_after = elo_w_before + K * (1 - ew)
        elo_l_after = elo_l_before + K * (0 - (1 - ew))
        elo_o[wslug] = elo_w_after
        elo_o[lslug] = elo_l_after

        # ELO surface
        ew_s = expected_score(elo_s[wslug][surface_raw], elo_s[lslug][surface_raw])
        elo_s[wslug][surface_raw] += K * (1 - ew_s)
        elo_s[lslug][surface_raw] += K * (0 - (1 - ew_s))

        # Stats
        games_played[wslug] += 1
        games_played[lslug] += 1
        last_match_date[wslug] = date
        last_match_date[lslug] = date
        wins_l5[wslug].append('V')
        wins_l5[lslug].append('D')
        if len(wins_l5[wslug]) > 5: wins_l5[wslug] = wins_l5[wslug][-5:]
        if len(wins_l5[lslug]) > 5: wins_l5[lslug] = wins_l5[lslug][-5:]

        # Match record (will resolve player IDs later)
        try:
            iso_date = f"{date[:4]}-{date[4:6]}-{date[6:8]}"
        except Exception:
            iso_date = None
        match_records.append({
            'date': iso_date,
            'surface': normalize_surface(surface_raw),
            'round': round_ or None,
            'winner_slug': wslug,
            'loser_slug': lslug,
            'score': score or None,
            'best_of': int(best_of) if best_of and best_of.isdigit() else 3,
            'elo_w_before': round(elo_w_before),
            'elo_l_before': round(elo_l_before),
            'elo_w_after': round(elo_w_after),
            'elo_l_after': round(elo_l_after),
            'duration_min': int(minutes) if minutes and minutes.isdigit() else None,
            'tournament_name': tname,
            'level': level,
        })

        # Snapshot if we crossed a snapshot date
        while next_snapshot_idx < len(snapshot_dates) and date >= snapshot_dates[next_snapshot_idx]:
            snap_date = snapshot_dates[next_snapshot_idx]
            iso = f"{snap_date[:4]}-{snap_date[4:6]}-{snap_date[6:8]}"
            for slug in players:
                if games_played[slug] >= 3:  # only players with some matches
                    elo_snapshots.append({
                        'slug': slug,
                        'date': iso,
                        'elo_overall': round(elo_o[slug]),
                        'elo_hard':    round(elo_s[slug].get('Hard', INIT_ELO)),
                        'elo_clay':    round(elo_s[slug].get('Clay', INIT_ELO)),
                        'elo_grass':   round(elo_s[slug].get('Grass', INIT_ELO)),
                        'elo_indoor':  round(elo_s[slug].get('Carpet', INIT_ELO)),
                    })
            next_snapshot_idx += 1

    # Final ELO state
    for slug, p in players.items():
        p['elo_overall'] = round(elo_o[slug])
        p['elo_hard']    = round(elo_s[slug].get('Hard', INIT_ELO))
        p['elo_clay']    = round(elo_s[slug].get('Clay', INIT_ELO))
        p['elo_grass']   = round(elo_s[slug].get('Grass', INIT_ELO))
        p['elo_indoor']  = round(elo_s[slug].get('Carpet', INIT_ELO))
        p['games_played']    = games_played[slug]
        p['last_match_date'] = last_match_date.get(slug, '')
        p['form_l5']         = ''.join(wins_l5[slug][-5:]) if wins_l5[slug] else None

    return players, match_records, elo_snapshots

# ── Snapshot dates: end of each month for last 24 months ──────────────────
def build_snapshot_dates():
    """Returns list of YYYYMMDD strings — last day of each month for last 24 months."""
    out = []
    today = datetime.utcnow()
    year, month = today.year, today.month
    for _ in range(24):
        # End of month = first of next month minus 1 day; simplified to 28 (always valid)
        out.append(f"{year:04d}{month:02d}28")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    out.reverse()
    return out

# ── Main ──────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("TudoTénis · Import COMPLETO (matches + ELO history + 500/tour)")
    print("=" * 60)

    snapshot_dates = build_snapshot_dates()
    print(f"\n[1/6] Loading CSVs (10 anos)…")
    atp_matches = load_matches('atp')
    wta_matches = load_matches('wta')
    print(f"      ATP: {len(atp_matches):,} matches | WTA: {len(wta_matches):,} matches")

    print(f"\n[2/6] Training ELO + collecting matches + snapshots…")
    print("  Snapshots em:", snapshot_dates[0], "→", snapshot_dates[-1], f"({len(snapshot_dates)} datas)")
    atp_p, atp_m, atp_snaps = process_tour(atp_matches, 'atp', snapshot_dates)
    wta_p, wta_m, wta_snaps = process_tour(wta_matches, 'wta', snapshot_dates)
    print(f"      ATP players: {len(atp_p):,} | matches: {len(atp_m):,} | snapshots: {len(atp_snaps):,}")
    print(f"      WTA players: {len(wta_p):,} | matches: {len(wta_m):,} | snapshots: {len(wta_snaps):,}")

    # Combine
    all_players = {**atp_p, **wta_p}
    all_matches = atp_m + wta_m
    all_snaps = atp_snaps + wta_snaps

    # ── Determine active + ranks ──
    cutoff_date = '20240101'
    def is_active(p):
        return p['games_played'] >= 5 and p.get('last_match_date', '') >= cutoff_date

    active_atp = sorted(
        [p for p in atp_p.values() if is_active(p)],
        key=lambda p: -p['elo_overall']
    )
    active_wta = sorted(
        [p for p in wta_p.values() if is_active(p)],
        key=lambda p: -p['elo_overall']
    )
    print(f"      → ATP active: {len(active_atp)} | WTA active: {len(active_wta)}")

    # Top 5 preview
    print("\n  Top 5 ATP por ELO:")
    for p in active_atp[:5]:
        print(f"    {p['elo_overall']:>5}  {p['name']} ({p['country']})  · games {p['games_played']}")
    print("  Top 5 WTA por ELO:")
    for p in active_wta[:5]:
        print(f"    {p['elo_overall']:>5}  {p['name']} ({p['country']})  · games {p['games_played']}")

    # Assign ranks
    for i, p in enumerate(active_atp):
        all_players[p['slug']]['atp_rank'] = i + 1 if i < 500 else None
    for i, p in enumerate(active_wta):
        all_players[p['slug']]['atp_rank'] = i + 1 if i < 500 else None

    # Active flag (top 500 of each tour)
    top_active_slugs = set(p['slug'] for p in active_atp[:500]) | set(p['slug'] for p in active_wta[:500])
    for slug, p in all_players.items():
        p['active'] = slug in top_active_slugs

    # Build players upsert rows
    print(f"\n[3/6] Upserting {len(all_players):,} players (todos os que apareceram em matches)…")
    player_rows = []
    for slug, p in all_players.items():
        player_rows.append({
            'slug': slug,
            'name': p['name'],
            'country': p['country'],
            'flag': p['flag'],
            'tour': p['tour'],
            'atp_rank': p.get('atp_rank'),
            'hand': p['hand'],
            'height_cm': p['height_cm'],
            'elo_overall': p['elo_overall'],
            'elo_hard': p['elo_hard'],
            'elo_clay': p['elo_clay'],
            'elo_grass': p['elo_grass'],
            'elo_indoor': p['elo_indoor'],
            'form_l5': p['form_l5'],
            'active': p['active'],
        })
    upsert_batch('players', player_rows, on_conflict='slug', batch_size=100, label='players')

    # ── Fetch slug → id mapping ──
    print(f"\n[4/6] Fetching player ID mapping…")
    slug_to_id = fetch_all_players_map()
    print(f"      Mapped {len(slug_to_id):,} slugs → IDs")

    # ── Build matches insert rows ──
    print(f"\n[5/6] Inserting {len(all_matches):,} matches…")
    match_rows = []
    for m in all_matches:
        wid = slug_to_id.get(m['winner_slug'])
        lid = slug_to_id.get(m['loser_slug'])
        if not wid or not lid:
            continue
        match_rows.append({
            'date': m['date'],
            'surface': m['surface'],
            'round': m['round'],
            'player1_id': wid,
            'player2_id': lid,
            'winner_id': wid,
            'score': m['score'],
            'best_of': m['best_of'],
            'elo1_before': m['elo_w_before'],
            'elo2_before': m['elo_l_before'],
            'elo1_after':  m['elo_w_after'],
            'elo2_after':  m['elo_l_after'],
            'duration_min': m['duration_min'],
            'status': 'finished',
        })
    insert_batch('matches', match_rows, batch_size=500, label='matches')

    # ── ELO history ──
    print(f"\n[6/6] Inserting {len(all_snaps):,} ELO history snapshots…")
    history_rows = []
    for s in all_snaps:
        pid = slug_to_id.get(s['slug'])
        if not pid:
            continue
        history_rows.append({
            'player_id': pid,
            'date': s['date'],
            'elo_overall': s['elo_overall'],
            'elo_hard': s['elo_hard'],
            'elo_clay': s['elo_clay'],
            'elo_grass': s['elo_grass'],
            'elo_indoor': s['elo_indoor'],
        })
    upsert_batch('elo_history', history_rows, on_conflict='player_id,date', batch_size=500, label='elo_history')

    # ── Update elo_30d_ago ──
    print(f"\n[bonus] Atualizar players.elo_30d_ago a partir do snapshot há ~30 dias…")
    # The snapshot ~30 days ago is the second-to-last in our list (last is current month)
    if len(snapshot_dates) >= 2:
        target_date = snapshot_dates[-2]
        iso = f"{target_date[:4]}-{target_date[4:6]}-{target_date[6:8]}"
        # Build slug → elo_overall_30d_ago
        slug_to_30d = {}
        for s in all_snaps:
            if s['date'] == iso:
                slug_to_30d[s['slug']] = s['elo_overall']
        # Update via PATCH per player (only top active)
        updated = 0
        for slug in top_active_slugs:
            elo30 = slug_to_30d.get(slug)
            if elo30 is None:
                continue
            pid = slug_to_id.get(slug)
            if not pid:
                continue
            status, _ = supa_request(
                f"players?id=eq.{pid}",
                method='PATCH',
                body={'elo_30d_ago': elo30},
                prefer='return=minimal',
            )
            if status in (200, 204):
                updated += 1
        print(f"  elo_30d_ago: ✅ {updated} players atualizados")

    print("\n" + "=" * 60)
    print("✅ Import COMPLETO terminado.")
    print(f"   Players: {len(all_players):,}")
    print(f"   Matches: {len(match_rows):,}")
    print(f"   ELO history: {len(history_rows):,}")
    print("=" * 60)

if __name__ == '__main__':
    main()
