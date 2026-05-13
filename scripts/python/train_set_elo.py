#!/usr/bin/env python3
"""
Train set-level ELO from Jeff Sackmann match-by-match CSVs.

Estratégia
──────────
- Para cada match, parse o score string ("6-4 4-6 6-3") em sets
- Cada set é um update ELO independente (winner +K, loser -K)
- K-factor menor que match-level (sets repetem-se → menos volatilidade
  precisa por update)
- 4 ratings em paralelo: overall, hard, clay, grass

Ajustes adicionais (Phase D)
────────────────────────────
- Recency decay: peso w = exp(-λ × idade_em_anos), half-life 18 meses.
  Matches antigos contribuem menos para o rating final.
- Injury detection: gap > 9 semanas entre matches de um jogador →
  penalty = 25 × √(weeks_off - 4) descontado ao ELO de retorno.
- K-factor inflado pós-lesão: 1.5× nos primeiros 20 matches de retorno,
  decaindo linearmente para 1× (Tennis Abstract style).
- Offseason exemption: gaps Nov-Jan descontam 6 semanas (offseason
  ATP/WTA normal é ~6 sem, não é lesão).

Composição BO3/BO5
──────────────────
Com setProb derivado por eloProb(setELO1, setELO2):
  P(BO3) = p² + 2p²q = p²(3 - 2p)
  P(BO5) = p³ + 3p³q + 6p³q²

Output
──────
Escreve elo_set_* + set_count em players (UPSERT por slug).
"""
import os, re, csv, json, sys, math, urllib.request, urllib.error
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# ── ENV ──────────────────────────────────────────────────────────────────
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
if not URL or not KEY:
    sys.exit('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}

# ── Config ───────────────────────────────────────────────────────────────
DATA_DIR = ROOT / 'data'
YEARS = list(range(2015, 2027))
INITIAL_ELO = 1500.0

# K-factor base para set updates. Mais pequeno que match-level (que é 32)
# porque cada match aplica 2-5 updates em vez de 1.
K_BY_LEVEL = {
    'G': 28,   # Grand Slam
    'M': 24,   # Masters 1000
    'F': 24,   # Tour Finals
    'A': 20,   # 250/500 ATP-Tour
    'D': 12,   # Davis Cup
    'C': 16,   # Challenger
    'S': 14,   # Satellite/ITF
}
def k_for_level(lvl):
    return K_BY_LEVEL.get(lvl, 18)

# Surface K-boost: cada superfície recebe apenas uma fracção dos matches
# (hard ≈60%, clay ≈28%, grass ≈10%). Para os ratings por surface terem
# spread comparável ao overall, multiplicamos K para superfícies menos
# frequentes. Boost calibrado pelo volume relativo no dataset.
SURFACE_K_BOOST = {
    'hard':  1.30,   # ~1/sqrt(0.6)
    'clay':  1.90,   # ~1/sqrt(0.28)
    'grass': 3.20,   # ~1/sqrt(0.10) — grass tem ~6k matches em 60k total
}

SURFACE_MAP = {
    'Hard':   'hard',
    'Clay':   'clay',
    'Grass':  'grass',
    'Carpet': None,   # tratamos carpet como neutro (não actualiza surface ELO)
}

# ── Recency decay ────────────────────────────────────────────────────────
# half-life de 18 meses (1.5 anos): match há 1.5a vale 50%, há 3a vale 25%
HALF_LIFE_YEARS = 1.5
LAMBDA = math.log(2) / HALF_LIFE_YEARS  # ≈ 0.4621 por ano

# ── Injury / layoff ──────────────────────────────────────────────────────
INJURY_THRESHOLD_WEEKS = 9            # gap > 9 sem = lesão
OFFSEASON_DISCOUNT_WEEKS = 6          # gaps Nov-Jan descontam offseason normal
K_BOOST_MATCHES = 20                  # # matches sob K inflado pós-retorno
K_BOOST_MAX = 1.5                     # K × 1.5 no 1º match pós-lesão (Tennis Abstract)

# ── Helpers ──────────────────────────────────────────────────────────────
def slugify(name):
    if not name: return ''
    import unicodedata
    # Strip diacritics
    nfkd = unicodedata.normalize('NFKD', name)
    ascii_only = ''.join(c for c in nfkd if not unicodedata.combining(c))
    s = ascii_only.lower()
    s = re.sub(r"[’'.]", '', s)        # apostrophes
    s = re.sub(r'[^a-z0-9]+', '-', s)
    s = re.sub(r'^-|-$', '', s)
    return s

SET_TOKEN_RE = re.compile(r'^(\d+)-(\d+)$')
NONSET_TOKENS = {'RET', 'W/O', 'WO', 'DEF', 'WALKOVER', 'UNK', 'ABN', 'ABD', ''}

def parse_sets(score):
    """
    Devolve lista de (winner_side, ga, gb).
    winner_side: 0 se match-winner ganhou este set, 1 se match-loser.
    Convenção Sackmann: primeiro número = games do match-winner.
    """
    if not score: return []
    out = []
    for token in score.split():
        if token.upper() in NONSET_TOKENS: break
        token = re.sub(r'\(\d+\)', '', token)  # strip tiebreak suffix
        m = SET_TOKEN_RE.match(token)
        if not m: continue
        a, b = int(m.group(1)), int(m.group(2))
        if a == b: continue
        out.append((0 if a > b else 1, a, b))
    return out

def expected(eloA, eloB):
    return 1.0 / (1.0 + 10 ** ((eloB - eloA) / 400))

def parse_yyyymmdd(s):
    return datetime.strptime(s, '%Y%m%d')

def inactivity_decay(rating, days_since_last):
    """
    Recency decay aplicado durante gaps de inactividade.
    Rating "envelhece" em direcção ao INITIAL_ELO entre matches consecutivos:
      r_new = INITIAL + (r_old - INITIAL) × exp(-λ × gap_years)

    Por construção, half-life de 18 meses significa que um jogador que pare
    18m perde metade da distância para 1500. Para jogadores activos (gap
    ~1 semana entre matches), o decay é ~0.1% por match — irrelevante.

    Esta abordagem mantém K cheio nos updates (sem compressão), e dá um
    "rust factor" automático que substitui a necessidade de detector
    explícito de lesão.
    """
    if days_since_last <= 0: return rating
    gap_years = days_since_last / 365.25
    factor = math.exp(-LAMBDA * gap_years)
    return INITIAL_ELO + (rating - INITIAL_ELO) * factor

def is_offseason_gap(last_date_str, current_date_str):
    """
    True se o gap atravessa o offseason típico ATP/WTA (Nov-Jan).
    Tour finals ~mid-Nov, restart ~Dec 28. Offseason = ~6 semanas.
    """
    last = parse_yyyymmdd(last_date_str)
    curr = parse_yyyymmdd(current_date_str)
    # Gap em diferentes anos OU diferente cycle de season
    if last.month >= 10 and curr.month <= 3 and curr.year > last.year:
        return True
    return False

def injury_penalty(weeks_off):
    """25 × √(weeks_off − 4) — cresce continuamente, sem plateau."""
    if weeks_off < INJURY_THRESHOLD_WEEKS: return 0.0
    return 25.0 * math.sqrt(weeks_off - 4)

def k_boost(matches_since_injury):
    """1.5× → 1.0× linear em 20 matches (Tennis Abstract)."""
    if matches_since_injury is None or matches_since_injury >= K_BOOST_MATCHES:
        return 1.0
    progress = matches_since_injury / K_BOOST_MATCHES   # 0..1
    return 1.0 + (K_BOOST_MAX - 1.0) * (1.0 - progress)

# ── Phase 1: load all matches chronologically ─────────────────────────────
def load_matches():
    rows = []
    for year in YEARS:
        for tour in ('atp', 'wta'):
            p = DATA_DIR / f'{tour}_matches_{year}.csv'
            if not p.exists(): continue
            with open(p) as f:
                for r in csv.DictReader(f):
                    rows.append({
                        'date':    r.get('tourney_date', ''),
                        'tour':    tour,
                        'surface': r.get('surface', ''),
                        'level':   r.get('tourney_level', 'A'),
                        'winner':  r.get('winner_name', ''),
                        'loser':   r.get('loser_name', ''),
                        'score':   r.get('score', ''),
                    })
    rows.sort(key=lambda r: r['date'])
    return rows

# ── Phase 2: train ───────────────────────────────────────────────────────
def train(matches):
    # nested dict: slug -> { 'overall', 'hard', 'clay', 'grass', 'set_count' }
    elos = defaultdict(lambda: {
        'overall': INITIAL_ELO, 'hard': INITIAL_ELO,
        'clay':    INITIAL_ELO, 'grass': INITIAL_ELO,
        'set_count': 0,
    })

    # Per-player: data do último match para calcular gap → inactivity decay
    last_match_date = {}        # slug -> 'YYYYMMDD'
    matches_since_layoff = {}   # slug -> int para K boost (Tennis Abstract style)

    skipped_score = 0
    trained_sets = 0
    layoffs_detected = 0
    last_year = None

    for m in matches:
        year = m['date'][:4] if m['date'] else '????'
        if year != last_year:
            print(f'  ▸ {year}…')
            last_year = year

        surf = SURFACE_MAP.get(m['surface'])
        winner_name = m['winner']
        loser_name  = m['loser']
        if not winner_name or not loser_name: continue

        sets = parse_sets(m['score'])
        if not sets:
            skipped_score += 1
            continue

        ws = slugify(winner_name)
        ls = slugify(loser_name)
        if not ws or not ls: continue

        match_dt = parse_yyyymmdd(m['date'])

        # ── Aplica inactivity decay a cada jogador (recency built-in)
        for player in (ws, ls):
            last_d = last_match_date.get(player)
            if last_d is None:
                continue
            gap_days = (match_dt - parse_yyyymmdd(last_d)).days
            if gap_days <= 7:
                continue   # actividade normal, decay desprezível
            # Desconta offseason quando aplicável
            effective_gap = gap_days
            if is_offseason_gap(last_d, m['date']):
                effective_gap = max(0, gap_days - OFFSEASON_DISCOUNT_WEEKS * 7)
            for key in ('overall', 'hard', 'clay', 'grass'):
                elos[player][key] = inactivity_decay(elos[player][key], effective_gap)
            # Long layoff (≥ 9 sem após offseason) → flag K boost para 20 matches
            if effective_gap >= INJURY_THRESHOLD_WEEKS * 7:
                matches_since_layoff[player] = 0
                layoffs_detected += 1

        # ── K-factor: base + boost pós-layoff (média entre os dois jogadores
        #    para preservar zero-sum)
        K_base = k_for_level(m['level'])
        boost = (k_boost(matches_since_layoff.get(ws))
               + k_boost(matches_since_layoff.get(ls))) / 2
        K_overall = K_base * boost
        K_surface = K_overall * SURFACE_K_BOOST.get(surf or '', 1.0)

        for set_winner_side, _ga, _gb in sets:
            if set_winner_side == 0:
                wslug, lslug = ws, ls
            else:
                wslug, lslug = ls, ws

            # Overall update (todos os matches)
            ew = elos[wslug]['overall']
            el = elos[lslug]['overall']
            exp_w = expected(ew, el)
            delta = K_overall * (1.0 - exp_w)
            elos[wslug]['overall'] = ew + delta
            elos[lslug]['overall'] = el - delta

            # Surface update (apenas se conhecido) — com K boost para compensar
            # menor volume de matches por superfície
            if surf:
                ew = elos[wslug][surf]
                el = elos[lslug][surf]
                exp_w = expected(ew, el)
                delta = K_surface * (1.0 - exp_w)
                elos[wslug][surf] = ew + delta
                elos[lslug][surf] = el - delta

            elos[wslug]['set_count'] += 1
            elos[lslug]['set_count'] += 1
            trained_sets += 1

        # Update tracking pós-match
        last_match_date[ws] = m['date']
        last_match_date[ls] = m['date']
        for player in (ws, ls):
            if player in matches_since_layoff:
                matches_since_layoff[player] += 1

    print(f'  ✅ {trained_sets:,} sets treinados  ·  {skipped_score} matches sem score válido')
    print(f'     {layoffs_detected:,} layoffs detectados (gap ≥ {INJURY_THRESHOLD_WEEKS} sem após offseason)')
    return elos

# ── Phase 3: write to Supabase ───────────────────────────────────────────
def supa_request(method, path, body=None, params=None):
    url = f'{URL}/rest/v1{path}'
    if params:
        from urllib.parse import urlencode
        url += '?' + urlencode(params)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=H, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def fetch_all_players():
    """Devolve dict slug → id."""
    print('  ▸ fetch players…')
    by_slug = {}
    offset = 0
    page = 1000
    while True:
        status, body = supa_request('GET', '/players',
            params={'select': 'id,slug', 'limit': page, 'offset': offset})
        if status != 200:
            print(f'  ❌ fetch error: {status} {body[:200]}')
            break
        items = json.loads(body)
        for it in items:
            by_slug[it['slug']] = it['id']
        if len(items) < page:
            break
        offset += page
    print(f'    {len(by_slug):,} players')
    return by_slug

def write_elos(elos, slug_to_id):
    """Bulk PATCH via Supabase. Apenas players que existem na DB."""
    print('  ▸ write ELOs…')
    # Round to 1 decimal
    def r(x): return round(x, 1)

    rows = []
    for slug, e in elos.items():
        pid = slug_to_id.get(slug)
        if not pid: continue
        if e['set_count'] == 0: continue
        rows.append({
            'id': pid,
            'elo_set_overall': r(e['overall']),
            'elo_set_hard':    r(e['hard'])  if e['hard']  != INITIAL_ELO else None,
            'elo_set_clay':    r(e['clay'])  if e['clay']  != INITIAL_ELO else None,
            'elo_set_grass':   r(e['grass']) if e['grass'] != INITIAL_ELO else None,
            'set_count':       e['set_count'],
        })

    print(f'    {len(rows):,} players com sets > 0')
    # PATCH individual por id — apenas as colunas que mandamos são tocadas
    # (POST/upsert dispara NOT NULL constraints em colunas que não mandamos).
    ok = 0
    fail = 0
    for idx, row in enumerate(rows, 1):
        pid = row.pop('id')
        url = f'{URL}/rest/v1/players?id=eq.{pid}'
        req = urllib.request.Request(
            url, data=json.dumps(row).encode(),
            headers={**H, 'Prefer': 'return=minimal'},
            method='PATCH',
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if 200 <= resp.status < 300: ok += 1
                else: fail += 1
        except urllib.error.HTTPError as e:
            fail += 1
            if fail <= 3:
                print(f'    id={pid}: {e.code} {e.read().decode()[:120]}')
        if idx % 250 == 0:
            print(f'    {idx:,}/{len(rows):,}  (ok={ok}, fail={fail})')
    print(f'  ✅ {ok}/{len(rows)} actualizados  ·  {fail} fail')

# ── Main ─────────────────────────────────────────────────────────────────
def main():
    print('[1/3] Carregar matches…')
    matches = load_matches()
    print(f'  {len(matches):,} matches lidos de {DATA_DIR}')
    if not matches:
        sys.exit('Sem dados — corre primeiro o import_full.py ou descarrega CSVs.')

    print('\n[2/3] Treinar set-level ELO…')
    elos = train(matches)
    print(f'  {len(elos):,} jogadores únicos com ELO calculado')

    # Distribution summary (top10)
    top = sorted(
        ((s, v['overall'], v['set_count']) for s, v in elos.items() if v['set_count'] >= 20),
        key=lambda x: -x[1]
    )[:10]
    print('\n  Top 10 set-ELO (≥20 sets):')
    for slug, elo, cnt in top:
        print(f'    {slug:30s}  set-ELO {elo:7.1f}   ({cnt:,} sets)')

    print('\n[3/3] Escrever para Supabase…')
    slug_to_id = fetch_all_players()
    write_elos(elos, slug_to_id)

    print('\nDONE.')

if __name__ == '__main__':
    main()
