"""
TudoTenis - Import Jeff Sackmann + Train ELO Model
====================================================
Lê 11 anos de matches (2015-2025) do Jeff Sackmann, calcula ELOs por
superfície e popula o Supabase.

Usage:
  cd /Users/zezematos/tudotenis/scripts/python
  pip3 install --user supabase python-dotenv
  python3 import_jeff_sackmann.py
"""
import os
import csv
import re
import math
from datetime import datetime
from collections import defaultdict
from pathlib import Path

import json
import urllib.request

def load_env(path):
    """Mini parser de .env (sem dependência externa)"""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

class SupabaseRest:
    """Cliente REST mínimo para Supabase (sem dependências)."""
    def __init__(self, url, key):
        self.url = url.rstrip('/')
        self.headers = {
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        }
    def upsert(self, table, rows, on_conflict):
        endpoint = f"{self.url}/rest/v1/{table}?on_conflict={on_conflict}"
        headers = {**self.headers, 'Prefer': 'resolution=merge-duplicates,return=minimal'}
        body = json.dumps(rows).encode()
        req = urllib.request.Request(endpoint, data=body, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            print(f"  HTTP {e.code} on table={table}: {err[:300]}")
            raise

# ───────────────────────────────────────────────────────────────────────────
# Setup
# ───────────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
ENV_PATH = ROOT.parent.parent / '.env.local'
load_env(str(ENV_PATH))

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
if not SUPABASE_URL or not SUPABASE_KEY:
    print(f"ERRO: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing in {ENV_PATH}")
    raise SystemExit(1)

DATA_DIR = ROOT / 'data'
YEARS = list(range(2015, 2026))  # 2015–2025

# ───────────────────────────────────────────────────────────────────────────
# ELO model
# ───────────────────────────────────────────────────────────────────────────
INIT_ELO = 1500
SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet']  # Sackmann usa estes labels

def k_factor(round_, level):
    """K-factor variável por importância do jogo."""
    base = 32
    # Slam > Masters > ATP500 > ATP250 > Challenger
    level_mult = {'G': 1.4, 'M': 1.2, 'A': 1.0, 'C': 0.85, 'D': 0.7}.get(level, 1.0)
    # Final > SF > ... > R128
    round_mult = {'F': 1.3, 'SF': 1.15, 'QF': 1.1, 'R16': 1.0, 'R32': 0.95,
                  'R64': 0.9, 'R128': 0.85}.get(round_, 1.0)
    return base * level_mult * round_mult

def expected_score(elo_a, elo_b):
    return 1.0 / (1.0 + 10 ** ((elo_b - elo_a) / 400))

def slugify(name):
    """João Pereira → 'joao-pereira'"""
    if not name:
        return None
    s = name.lower().strip()
    # remove diacritics simply
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

# ───────────────────────────────────────────────────────────────────────────
# Country code → emoji flag
# ───────────────────────────────────────────────────────────────────────────
IOC_TO_ISO2 = {
    'ARG': 'AR', 'AUS': 'AU', 'AUT': 'AT', 'BLR': 'BY', 'BRA': 'BR',
    'CAN': 'CA', 'CHI': 'CL', 'CHN': 'CN', 'CRO': 'HR', 'CZE': 'CZ',
    'DEN': 'DK', 'ESP': 'ES', 'FIN': 'FI', 'FRA': 'FR', 'GBR': 'GB',
    'GER': 'DE', 'GRE': 'GR', 'HUN': 'HU', 'IND': 'IN', 'ISR': 'IL',
    'ITA': 'IT', 'JPN': 'JP', 'KAZ': 'KZ', 'KOR': 'KR', 'LAT': 'LV',
    'LTU': 'LT', 'MEX': 'MX', 'NED': 'NL', 'NOR': 'NO', 'POL': 'PL',
    'POR': 'PT', 'RSA': 'ZA', 'RUS': 'RU', 'SLO': 'SI', 'SRB': 'RS',
    'SUI': 'CH', 'SVK': 'SK', 'SWE': 'SE', 'TPE': 'TW', 'TUN': 'TN',
    'UKR': 'UA', 'URU': 'UY', 'USA': 'US', 'UZB': 'UZ', 'VEN': 'VE',
    'BUL': 'BG', 'BIH': 'BA', 'COL': 'CO', 'EST': 'EE', 'BEL': 'BE',
    'EGY': 'EG', 'ARM': 'AM', 'ROU': 'RO', 'GEO': 'GE', 'BAR': 'BB',
    'PER': 'PE', 'PAR': 'PY', 'BOL': 'BO', 'ECU': 'EC', 'CYP': 'CY',
    'TUR': 'TR', 'NZL': 'NZ', 'IRL': 'IE', 'LUX': 'LU', 'MON': 'MC',
    'IRI': 'IR', 'INA': 'ID', 'PHI': 'PH', 'THA': 'TH', 'MAR': 'MA',
    'ALG': 'DZ', 'KSA': 'SA', 'QAT': 'QA', 'UAE': 'AE', 'SGP': 'SG',
}

def country_to_flag(ioc):
    if not ioc or len(ioc) != 3:
        return None
    iso2 = IOC_TO_ISO2.get(ioc.upper())
    if not iso2:
        return None
    # Regional Indicator Symbols
    return ''.join(chr(ord(c) - ord('A') + 0x1F1E6) for c in iso2)

# ───────────────────────────────────────────────────────────────────────────
# Read & process matches
# ───────────────────────────────────────────────────────────────────────────
def load_matches(prefix='atp'):
    """Loads all matches from CSV files in chronological order."""
    all_matches = []
    for year in YEARS:
        f = DATA_DIR / f'{prefix}_matches_{year}.csv'
        if not f.exists():
            print(f"  WARN: {f} not found")
            continue
        with open(f, encoding='utf-8') as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                all_matches.append(row)
    # sort by tourney_date + match_num
    all_matches.sort(key=lambda r: (r.get('tourney_date', ''), r.get('match_num', '0')))
    return all_matches

def train_elo(matches, tour='atp'):
    """Returns dict of player_id -> {name, country, elo_overall, elo_<surface>, ...}"""
    players = {}
    elo_o = defaultdict(lambda: INIT_ELO)
    elo_s = defaultdict(lambda: defaultdict(lambda: INIT_ELO))
    games_played = defaultdict(int)
    last_match_date = {}
    wins_l5 = defaultdict(list)  # last 5 results (1=win, 0=loss)

    print(f"  Processing {len(matches):,} {tour.upper()} matches...")

    for i, m in enumerate(matches):
        try:
            wid = m['winner_id']
            lid = m['loser_id']
            wname = m.get('winner_name', '').strip()
            lname = m.get('loser_name', '').strip()
            wioc = m.get('winner_ioc', '').strip()
            lioc = m.get('loser_ioc', '').strip()
            surface = m.get('surface', '').strip() or 'Hard'
            round_ = m.get('round', '').strip()
            level = m.get('tourney_level', '').strip()
            date = m.get('tourney_date', '').strip()
        except KeyError:
            continue
        if not wid or not lid or not wname or not lname:
            continue

        # Update player metadata
        for pid, name, ioc in [(wid, wname, wioc), (lid, lname, lioc)]:
            if pid not in players:
                players[pid] = {
                    'tour': tour,
                    'sackmann_id': pid,
                    'name': name,
                    'country': ioc,
                    'flag': country_to_flag(ioc),
                    'birth_date': None,
                    'height_cm': None,
                    'hand': None,
                }
        # Add player extras
        try:
            if m.get('winner_ht') and not players[wid].get('height_cm'):
                players[wid]['height_cm'] = int(float(m['winner_ht'])) if m['winner_ht'] else None
            if m.get('loser_ht') and not players[lid].get('height_cm'):
                players[lid]['height_cm'] = int(float(m['loser_ht'])) if m['loser_ht'] else None
            if m.get('winner_hand'):
                hand = m['winner_hand']
                if hand == 'R': players[wid]['hand'] = 'right'
                elif hand == 'L': players[wid]['hand'] = 'left'
            if m.get('loser_hand'):
                hand = m['loser_hand']
                if hand == 'R': players[lid]['hand'] = 'right'
                elif hand == 'L': players[lid]['hand'] = 'left'
        except (ValueError, KeyError):
            pass

        # K-factor
        K = k_factor(round_, level)

        # ELO overall
        ew = expected_score(elo_o[wid], elo_o[lid])
        elo_o[wid] += K * (1 - ew)
        elo_o[lid] += K * (0 - (1 - ew))

        # ELO surface (Carpet -> Indoor for our schema)
        surf_key = surface
        ew_s = expected_score(elo_s[wid][surf_key], elo_s[lid][surf_key])
        elo_s[wid][surf_key] += K * (1 - ew_s)
        elo_s[lid][surf_key] += K * (0 - (1 - ew_s))

        # Stats
        games_played[wid] += 1
        games_played[lid] += 1
        last_match_date[wid] = date
        last_match_date[lid] = date

        # Form L5
        wins_l5[wid].append('V')
        wins_l5[lid].append('D')
        if len(wins_l5[wid]) > 5: wins_l5[wid] = wins_l5[wid][-5:]
        if len(wins_l5[lid]) > 5: wins_l5[lid] = wins_l5[lid][-5:]

    # Compose final players dict with ELOs
    for pid, p in players.items():
        p['elo_overall'] = round(elo_o[pid])
        p['elo_hard']    = round(elo_s[pid]['Hard'])    if elo_s[pid]['Hard']    else INIT_ELO
        p['elo_clay']    = round(elo_s[pid]['Clay'])    if elo_s[pid]['Clay']    else INIT_ELO
        p['elo_grass']   = round(elo_s[pid]['Grass'])   if elo_s[pid]['Grass']   else INIT_ELO
        p['elo_indoor']  = round(elo_s[pid]['Carpet'])  if elo_s[pid]['Carpet']  else INIT_ELO
        p['games_played'] = games_played[pid]
        p['last_match_date'] = last_match_date[pid]
        p['form_l5'] = ''.join(wins_l5[pid][-5:]) if wins_l5[pid] else None
        p['slug'] = slugify(p['name'])
    return list(players.values())

# ───────────────────────────────────────────────────────────────────────────
# Main
# ───────────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("TudoTenis · Jeff Sackmann import + ELO training")
    print("=" * 60)

    print("\n[1/4] Loading ATP matches…")
    atp_matches = load_matches('atp')
    print(f"      {len(atp_matches):,} matches")

    print("\n[2/4] Loading WTA matches…")
    wta_matches = load_matches('wta')
    print(f"      {len(wta_matches):,} matches")

    print("\n[3/4] Training ELO model…")
    atp_players = train_elo(atp_matches, 'atp')
    wta_players = train_elo(wta_matches, 'wta')
    print(f"      {len(atp_players):,} ATP players")
    print(f"      {len(wta_players):,} WTA players")

    # Filter: only players with >= 5 matches in last 2 years (active)
    cutoff_date = '20240101'
    def is_active(p):
        return p['games_played'] >= 5 and p.get('last_match_date', '') >= cutoff_date
    atp_active = [p for p in atp_players if is_active(p)]
    wta_active = [p for p in wta_players if is_active(p)]
    atp_active.sort(key=lambda p: -p['elo_overall'])
    wta_active.sort(key=lambda p: -p['elo_overall'])
    print(f"      → {len(atp_active)} ATP active (top 200 will be uploaded)")
    print(f"      → {len(wta_active)} WTA active (top 200 will be uploaded)")

    # Top players
    print("\n  Top 5 ATP by ELO:")
    for p in atp_active[:5]:
        print(f"    {p['elo_overall']:>5}  {p['name']} ({p['country']})  · games {p['games_played']}")
    print("\n  Top 5 WTA by ELO:")
    for p in wta_active[:5]:
        print(f"    {p['elo_overall']:>5}  {p['name']} ({p['country']})  · games {p['games_played']}")

    # Take top 200 of each tour
    to_upload = atp_active[:200] + wta_active[:200]

    # Add atp_rank based on ELO order
    for i, p in enumerate(atp_active[:200]):
        p['atp_rank'] = i + 1
    for i, p in enumerate(wta_active[:200]):
        p['atp_rank'] = i + 1

    print(f"\n[4/4] Upserting {len(to_upload)} players to Supabase…")
    sb = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

    # Resolve duplicate slugs (some names normalize to same slug)
    used_slugs = {}
    rows = []
    for p in to_upload:
        slug = p['slug']
        if slug in used_slugs:
            slug = f"{slug}-{p['sackmann_id']}"
        used_slugs[slug] = True
        rows.append({
            'slug': slug,
            'name': p['name'],
            'country': p['country'],
            'flag': p['flag'],
            'tour': p['tour'],
            'atp_rank': p['atp_rank'],
            'hand': p['hand'],
            'height_cm': p['height_cm'],
            'elo_overall': p['elo_overall'],
            'elo_hard': p['elo_hard'],
            'elo_clay': p['elo_clay'],
            'elo_grass': p['elo_grass'],
            'elo_indoor': p['elo_indoor'],
            'form_l5': p['form_l5'],
            'active': True,
        })

    # Batch upsert via REST
    batch_size = 100
    n_batches = (len(rows) - 1) // batch_size + 1
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        sb.upsert('players', batch, on_conflict='slug')
        print(f"  Batch {i//batch_size + 1}/{n_batches}: {len(batch)} rows ✓")

    print("\n✓ Done! Verifica em https://tudotenis.vercel.app/ranking")

if __name__ == '__main__':
    main()
