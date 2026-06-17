#!/usr/bin/env python3
"""
Train doubles ELO per-player, chronologicamente, a partir dos CSVs
scrapados de TennisExplorer (scripts/python/data/te_doubles/).

Estratégia
──────────
- Para cada match: team_elo = (p1.elo + p2.elo) / 2 (média da equipa)
- expected = 1 / (1 + 10^((opp_team_elo - team_elo) / 400))
- delta = K × (actual - expected)
- Cada jogador da equipa winner ganha +delta; loser perde -delta
- K calibrado por categoria do torneio
- Surface boost (clay/grass têm K maior porque menos jogos)

Categoria do torneio derivada do tournament_slug + tournament_name:
  slam (G)   → K=40
  m1000 (M)  → K=36
  finals (F) → K=36
  500 (A5)   → K=32
  250 (A2)   → K=28
  challenger → K=20
  itf        → K=16

Surface boost (iguais ao train_set_elo.py):
  hard ×1.30, clay ×1.90, grass ×3.20

Resolução de nomes
──────────────────
TE tem nomes abreviados: "Bhambri Y" / "Olivetti". Para casar com nossa DB:
  1. Match exacto por last-name (após normalizar accent + lower)
  2. Para colisões: usa first-initial
  3. Sem match: insere player novo (active=false, tour atp/wta)

Output: PATCH players.elo_doubles_* + doubles_matches counter para
players matched; insere para os novos.
"""
import os, csv, sys, math, json, urllib.request, urllib.error, unicodedata, re
from pathlib import Path
from collections import defaultdict
from datetime import datetime, date


# ── ENV ──────────────────────────────────────────────────────────────────
def load_env(p):
    if not os.path.exists(p): return
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
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
DATA_DIR = ROOT / 'data' / 'te_doubles'
INITIAL_ELO = 1500.0

# K-factor por categoria
K_BY_CATEGORY = {
    'slam':       40,
    '1000':       36,
    'finals':     36,
    '500':        32,
    '250':        28,
    'challenger': 20,
    'itf':        16,
}

# Surface boost — compensa volume desigual (hard ≈60%, clay ≈28%, grass ≈12%)
SURFACE_K_BOOST = {
    'hard':   1.30,
    'clay':   1.90,
    'grass':  3.20,
    'indoor': 1.30,
}

# Recency decay (half-life 2 anos para doubles, mais longo que singles
# porque parcerias estabelecidas mudam menos)
HALF_LIFE_YEARS = 2.0
LAMBDA = math.log(2) / HALF_LIFE_YEARS

# Slam tournament slugs (TennisExplorer naming)
SLAMS = {'wimbledon', 'roland-garros', 'french-open', 'us-open', 'australian-open',
         'usopen', 'ausopen', 'frenchopen'}

# Masters 1000 slugs
M1000 = {'indian-wells', 'miami', 'monte-carlo', 'madrid', 'rome', 'italian-open',
         'canada', 'montreal', 'toronto', 'cincinnati', 'shanghai', 'paris',
         'paris-masters', 'monte-carlo-masters', 'madrid-open', 'canadian-open'}

# 500-level (ATP)
ATP_500 = {'rotterdam', 'dubai', 'acapulco', 'barcelona', 'queens', 'queens-club',
           'halle', 'hamburg', 'washington', 'beijing', 'tokyo', 'vienna', 'basel',
           'eastbourne', 'rio', 'rio-de-janeiro'}

# WTA 1000s
WTA_1000 = {'indian-wells', 'miami', 'madrid', 'rome', 'beijing', 'wuhan',
            'cincinnati', 'toronto', 'montreal', 'dubai', 'doha', 'guadalajara'}


def categorize(slug: str, name: str, tour: str) -> str:
    """Devolve categoria para K-factor lookup."""
    s = slug.lower()
    n = name.lower()
    if any(t in s for t in SLAMS) or any(t in n for t in ['grand slam', 'french open',
            'roland garros', 'wimbledon', 'us open', 'australian open']):
        return 'slam'
    if 'finals' in n and ('atp' in n or 'wta' in n or 'tour' in n):
        return 'finals'
    if any(t in s for t in M1000) and tour == 'atp-double':
        return '1000'
    if any(t in s for t in WTA_1000) and tour == 'wta-double':
        return '1000'
    if any(t in s for t in ATP_500) and tour == 'atp-double':
        return '500'
    if 'challenger' in s or 'chall' in n.lower():
        return 'challenger'
    if any(re.match(r'^[mw](?:15|25|35|50|75|100)\b', n.lower()) for _ in [0]):
        return 'itf'
    if 'itf' in s or 'itf' in n.lower():
        return 'itf'
    # default: ATP/WTA 250
    return '250'


# ── Helpers ──────────────────────────────────────────────────────────────
def strip_accents(s: str) -> str:
    nfkd = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in nfkd if not unicodedata.combining(c))


def norm_name(s: str) -> str:
    """Normaliza para matching: lowercase, sem accents, só letras."""
    s = strip_accents(s).lower()
    return re.sub(r'[^a-z]', '', s)


def parse_te_name(s: str) -> tuple[str, str]:
    """
    "Bhambri Y" → ('bhambri', 'y')
    "Felix Auger-Aliassime" → ('augeraliassime', 'f') (mas raro neste formato)
    "Pavlasek A." → ('pavlasek', 'a')
    """
    s = strip_accents(s).strip()
    s = re.sub(r'\.', '', s)  # remove dots from initials
    parts = re.split(r'\s+', s)
    if len(parts) >= 2:
        # Last token é geralmente initial(s), tudo o resto é o apelido
        # Mas para nomes hispânicos pode ser dois apelidos
        last_token = parts[-1]
        if len(last_token) <= 2:
            # Iniciais
            return norm_name(' '.join(parts[:-1])), norm_name(last_token)
        else:
            # Sem iniciais — assume tudo é nome
            return norm_name(' '.join(parts)), ''
    return norm_name(s), ''


def expected(eloA: float, eloB: float) -> float:
    return 1.0 / (1.0 + 10 ** ((eloB - eloA) / 400.0))


def k_for(slug: str, name: str, tour: str) -> int:
    cat = categorize(slug, name, tour)
    return K_BY_CATEGORY.get(cat, 24)


def inactivity_decay(elo: float, days_gap: int) -> float:
    """Decay puxa o ELO para 1500 conforme o gap de inactividade."""
    if days_gap < 30:
        return elo
    years = days_gap / 365.25
    return INITIAL_ELO + (elo - INITIAL_ELO) * math.exp(-LAMBDA * years)


# ── Supabase API ─────────────────────────────────────────────────────────
def supa(method: str, path: str, body=None, params=None, max_retries=8):
    """Call Supabase REST com retry agressivo para erros transientes
    (DNS, network reset, 5xx). max_retries=8 com base 3s = até ~30s de
    espera total, suficiente para outages de DNS curtos."""
    import time as _time
    url = f'{URL}/rest/v1{path}'
    if params:
        from urllib.parse import urlencode
        url += '?' + urlencode(params)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
    last_err = None
    for attempt in range(max_retries):
        req = urllib.request.Request(url, data=data, headers=H, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, resp.read().decode()
        except urllib.error.HTTPError as e:
            # 5xx → retry; outras (4xx) → devolve já
            if e.code >= 500 and attempt < max_retries - 1:
                _time.sleep(3 + attempt)
                continue
            return e.code, e.read().decode()
        except (urllib.error.URLError, ConnectionResetError, TimeoutError, OSError) as e:
            last_err = e
            if attempt < max_retries - 1:
                wait = 3 + attempt * 2  # 3, 5, 7, 9, 11, 13, 15s = ~63s total
                print(f'    ⚠ {type(e).__name__}: {e!s} — retry {attempt+1}/{max_retries} em {wait}s')
                _time.sleep(wait)
                continue
            raise
    raise last_err if last_err else RuntimeError('supa exhausted retries')


def trunc_norm(s: str, n: int = 9) -> str:
    """TE trunca last names a ~9 chars. Indexamos com prefix de tamanho n
    para apanhar truncações tipo 'granollers' → 'granoller' (8 chars)."""
    return s[:n]


def fetch_all_players() -> dict:
    """Fetch all players de DB → dict por norm-lastname + tour.

    Indexa por:
      - lastname completo
      - lastname truncado a 9 chars (para casar com truncação do TE)
      - fullname completo
    """
    print('  ▸ fetch players from DB…')
    by_last_tour: dict[tuple[str, str], list[dict]] = defaultdict(list)
    by_lasttrunc_tour: dict[tuple[str, str], list[dict]] = defaultdict(list)
    by_full_tour: dict[tuple[str, str], list[dict]] = defaultdict(list)
    offset = 0
    page = 1000
    while True:
        status, body = supa('GET', '/players', params={
            'select': 'id,slug,name,tour,country', 'limit': page, 'offset': offset
        })
        if status != 200:
            print(f'  ❌ fetch error: {status} {body[:200]}')
            break
        items = json.loads(body)
        for p in items:
            tour_short = 'atp-double' if p['tour'] == 'atp' else 'wta-double'
            full = norm_name(p['name'])
            parts = strip_accents(p['name']).split()
            if parts:
                last = norm_name(parts[-1])
                by_last_tour[(last, tour_short)].append(p)
                # Indexa também por prefix-9 para casar truncações TE
                if len(last) > 8:
                    by_lasttrunc_tour[(trunc_norm(last), tour_short)].append(p)
            by_full_tour[(full, tour_short)].append(p)
        if len(items) < page:
            break
        offset += page
    total = sum(len(v) for v in by_full_tour.values())
    print(f'    {total} players indexed by last-name + trunc-name + full-name')
    return {
        'by_last': by_last_tour,
        'by_lasttrunc': by_lasttrunc_tour,
        'by_full': by_full_tour,
        'by_te_slug': {},  # populated as we resolve / create
    }


def resolve_player(te_name: str, te_slug: str, tour: str, idx: dict) -> dict | None:
    """Encontra player no DB por matching name/slug, com cache por TE slug."""
    # 1. Cache hit por TE slug (set após criar new players ou primeiro match)
    cached = idx['by_te_slug'].get(te_slug)
    if cached:
        return cached

    last_norm, first_norm = parse_te_name(te_name)

    def pick(candidates: list) -> dict | None:
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]
        if first_norm:
            filt = [c for c in candidates if norm_name(c['name']).startswith(first_norm)]
            if len(filt) == 1:
                return filt[0]
            if len(filt) > 1:
                return filt[0]
        return candidates[0]

    # 2. Last-name exacto
    p = pick(idx['by_last'].get((last_norm, tour), []))
    if p:
        idx['by_te_slug'][te_slug] = p
        return p

    # 3. Last-name truncado (TE corta nomes longos a 9 chars: "Granollers"
    #    → "Granoller"). Tenta match por prefix-9.
    if len(last_norm) >= 7:  # só vale a pena se já tem tamanho razoável
        p = pick(idx['by_lasttrunc'].get((trunc_norm(last_norm), tour), []))
        if p:
            idx['by_te_slug'][te_slug] = p
            return p

    # 4. Full-name match
    full = norm_name(te_name)
    p = pick(idx['by_full'].get((full, tour), []))
    if p:
        idx['by_te_slug'][te_slug] = p
        return p

    return None


def insert_new_player(te_name: str, te_slug: str, tour_short: str) -> dict | None:
    """Insere 1 player. Mantido para compatibilidade. Para batch usar
    `prepare_missing_players` que é muito mais rápido + resilente."""
    return _insert_batch([{
        'te_name': te_name, 'te_slug': te_slug, 'tour': tour_short
    }]).get(te_slug)


def _make_row(te_name: str, te_slug: str, tour_short: str) -> dict:
    """Body para POST /players a partir de TE data."""
    tour = 'atp' if tour_short == 'atp-double' else 'wta'
    db_slug = f'te-{te_slug}'
    return {
        'slug': db_slug,
        'name': te_name.strip(),
        'tour': tour,
        'active': False,
        'elo_overall': 1500,
        'elo_doubles_overall': 1500,
    }


def _insert_batch(items: list[dict]) -> dict:
    """
    Insere players em batch (1 POST por batch). Devolve dict
    te_slug → {id, slug, name, tour}.

    PostgREST aceita array body para bulk insert. Conflictos por slug
    são tratados com Prefer: resolution=merge-duplicates,return=representation.
    """
    if not items:
        return {}
    rows = [_make_row(it['te_name'], it['te_slug'], it['tour']) for it in items]
    # Usa Prefer return=representation + resolution=merge-duplicates para
    # idempotência: se já existir, devolve a linha existente em vez de erro.
    url = f'{URL}/rest/v1/players?on_conflict=slug'
    req = urllib.request.Request(
        url, data=json.dumps(rows).encode(),
        headers={**H, 'Prefer': 'resolution=merge-duplicates,return=representation'},
        method='POST',
    )
    import time as _time
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
                # Map back to te_slug
                out = {}
                for it, row in zip(items, data):
                    out[it['te_slug']] = row
                return out
        except urllib.error.HTTPError as e:
            err_body = e.read().decode()[:300]
            print(f'    ⚠ HTTP {e.code} on batch insert: {err_body}')
            if e.code >= 500 and attempt < 7:
                _time.sleep(3 + attempt * 2)
                continue
            return {}
        except (urllib.error.URLError, ConnectionResetError, TimeoutError, OSError) as e:
            wait = 3 + attempt * 2
            print(f'    ⚠ {type(e).__name__} on batch insert: {e!s} — retry em {wait}s')
            _time.sleep(wait)
    return {}


def prepare_missing_players(matches: list[dict], idx: dict) -> int:
    """
    Pre-pass: itera todos os matches, identifica players que precisam de
    auto-create, e faz bulk insert em batches de 200.

    Reduz drasticamente o nº de POSTs (de N por match → ~50-100 total).
    Imune a falhas DNS transientes durante o training loop.

    Devolve nº de players criados.
    """
    print('\n[pre-pass] Identifying missing players…')

    # Mapa te_slug → (te_name, tour) — uma entrada por unique slug
    missing: dict[str, tuple[str, str]] = {}
    for m in matches:
        tour = m['tour']
        for slot in ('t1_p1', 't1_p2', 't2_p1', 't2_p2'):
            te_slug = m[f'{slot}_slug']
            te_name = m[f'{slot}_name']
            if not te_slug:
                continue
            # Já sabemos quem é?
            if te_slug in idx['by_te_slug']:
                continue
            # Tenta resolver via DB
            p = resolve_player(te_name, te_slug, tour, idx)
            if p:
                continue
            missing[te_slug] = (te_name, tour)

    print(f'  {len(missing)} unique players novos a inserir')
    if not missing:
        return 0

    # Bulk insert em batches de 200 (PostgREST suporta payloads grandes
    # mas batches menores recuperam melhor de falhas)
    items = [{'te_name': nm, 'te_slug': sl, 'tour': tr}
             for sl, (nm, tr) in missing.items()]
    BATCH = 200
    created = 0
    for i in range(0, len(items), BATCH):
        chunk = items[i:i + BATCH]
        out = _insert_batch(chunk)
        # Update idx
        for te_slug, row in out.items():
            te_name = next((it['te_name'] for it in chunk if it['te_slug'] == te_slug), '')
            tour = next((it['tour'] for it in chunk if it['te_slug'] == te_slug), '')
            idx['by_te_slug'][te_slug] = row
            last_norm, _ = parse_te_name(te_name)
            if last_norm:
                idx['by_last'][(last_norm, tour)].append(row)
            idx['by_full'][(norm_name(te_name), tour)].append(row)
        created += len(out)
        print(f'  inserted {created:,}/{len(items):,}')
    print(f'  ✅ {created} players criados via batch')
    return created


# ── Main train loop ──────────────────────────────────────────────────────
def load_all_matches() -> list[dict]:
    """Lê todos os CSVs ordenados por data."""
    all_rows: list[dict] = []
    files = sorted(DATA_DIR.glob('*.csv'))
    for f in files:
        with open(f, encoding='utf-8') as fp:
            for row in csv.DictReader(fp):
                row['_file'] = f.name
                all_rows.append(row)
    all_rows.sort(key=lambda r: r.get('date', '') + r.get('match_id', ''))
    return all_rows


def train(matches: list[dict], idx: dict, dry_run: bool = False,
          auto_create: bool = True) -> dict:
    """
    Estado per-player:
      elos[id] = {'overall', 'hard', 'clay', 'grass', 'count', 'last_date'}
    """
    elos: dict[int, dict] = defaultdict(lambda: {
        'overall': INITIAL_ELO,
        'hard':    INITIAL_ELO,
        'clay':    INITIAL_ELO,
        'grass':   INITIAL_ELO,
        'count':   0,
        'count_24m': 0,
        'last_date': None,
    })

    # Track players sem match (para reporting)
    unmatched: dict[str, int] = defaultdict(int)
    skipped_void = 0
    trained = 0
    by_year: dict[str, int] = defaultdict(int)
    last_year = None

    for m in matches:
        date_str = m.get('date', '')
        year = date_str[:4]
        if year != last_year:
            if last_year:
                print(f'  ▸ {last_year}: {by_year[last_year]:,} matches treinados')
            last_year = year

        if m.get('winner_team') in ('0', 0, '', None):
            skipped_void += 1
            continue

        tour = m['tour']  # 'atp-double' | 'wta-double'
        # Resolve 4 jogadores via cache (pre-pass já inseriu todos os
        # missing). Em dry-run, simula com fake IDs sem DB.
        def get_or_create(te_name, te_slug):
            if not te_slug:
                return None
            p = resolve_player(te_name, te_slug, tour, idx)
            if p:
                return p
            if not auto_create:
                return None
            if dry_run:
                # Simula com fake ID negativo (Postgres é positivo)
                fake_id = -(abs(hash(te_slug)) % 10_000_000)
                fake_p = {'id': fake_id, 'slug': f'te-{te_slug}',
                          'name': te_name.strip(),
                          'tour': 'atp' if tour == 'atp-double' else 'wta'}
                idx['by_te_slug'][te_slug] = fake_p
                last_norm, _ = parse_te_name(te_name)
                if last_norm:
                    idx['by_last'][(last_norm, tour)].append(fake_p)
                idx['by_full'][(norm_name(te_name), tour)].append(fake_p)
                return fake_p
            # Real run: pre-pass devia ter coberto, mas se algo escapar
            # (race de TE slugs entre passes) cai aqui — falha mas log
            print(f'    ⚠ Player não pre-created: {te_name} ({te_slug})')
            return None

        p1a = get_or_create(m['t1_p1_name'], m['t1_p1_slug'])
        p1b = get_or_create(m['t1_p2_name'], m['t1_p2_slug'])
        p2a = get_or_create(m['t2_p1_name'], m['t2_p1_slug'])
        p2b = get_or_create(m['t2_p2_name'], m['t2_p2_slug'])
        missing = []
        if not p1a: missing.append(m['t1_p1_name'])
        if not p1b: missing.append(m['t1_p2_name'])
        if not p2a: missing.append(m['t2_p1_name'])
        if not p2b: missing.append(m['t2_p2_name'])
        if missing:
            for nm in missing:
                unmatched[nm] += 1
            continue

        # Inactivity decay aos 4 jogadores
        match_dt = datetime.strptime(date_str, '%Y-%m-%d').date() if date_str else None
        K = k_for(m.get('tournament_slug', ''), m.get('tournament_name', ''), tour)
        surface = m.get('surface', 'hard').lower()
        K_overall = K
        K_surface = K * SURFACE_K_BOOST.get(surface, 1.0)

        # Per-player state get + decay
        for p in (p1a, p1b, p2a, p2b):
            st = elos[p['id']]
            if st['last_date'] and match_dt:
                gap = (match_dt - st['last_date']).days
                if gap > 60:
                    st['overall'] = inactivity_decay(st['overall'], gap)
                    st['hard'] = inactivity_decay(st['hard'], gap)
                    st['clay'] = inactivity_decay(st['clay'], gap)
                    st['grass'] = inactivity_decay(st['grass'], gap)

        # Team ELOs
        t1_overall = (elos[p1a['id']]['overall'] + elos[p1b['id']]['overall']) / 2
        t2_overall = (elos[p2a['id']]['overall'] + elos[p2b['id']]['overall']) / 2

        winner_team = int(m['winner_team'])  # 1 or 2
        actual_t1 = 1.0 if winner_team == 1 else 0.0

        # Overall ELO update
        exp_t1 = expected(t1_overall, t2_overall)
        delta_ovr = K_overall * (actual_t1 - exp_t1)
        for p in (p1a, p1b):
            elos[p['id']]['overall'] += delta_ovr
        for p in (p2a, p2b):
            elos[p['id']]['overall'] -= delta_ovr

        # Surface update (se conhecida + suportada)
        if surface in ('hard', 'clay', 'grass'):
            t1_surf = (elos[p1a['id']][surface] + elos[p1b['id']][surface]) / 2
            t2_surf = (elos[p2a['id']][surface] + elos[p2b['id']][surface]) / 2
            exp_t1_surf = expected(t1_surf, t2_surf)
            delta_surf = K_surface * (actual_t1 - exp_t1_surf)
            for p in (p1a, p1b):
                elos[p['id']][surface] += delta_surf
            for p in (p2a, p2b):
                elos[p['id']][surface] -= delta_surf

        # Counters + last_date
        for p in (p1a, p1b, p2a, p2b):
            elos[p['id']]['count'] += 1
            if match_dt:
                elos[p['id']]['last_date'] = match_dt

        trained += 1
        by_year[year] += 1

    if last_year:
        print(f'  ▸ {last_year}: {by_year[last_year]:,} matches treinados')

    print(f'\n  ✅ {trained:,} matches treinados | {skipped_void} voids | {len(unmatched)} unique unmatched names')
    # Top unmatched
    top_um = sorted(unmatched.items(), key=lambda x: -x[1])[:15]
    if top_um:
        print('\n  Top 15 names não encontrados:')
        for n, c in top_um:
            print(f'    {c:4d}× {n}')

    # 24m counter (matches nos últimos 730 dias)
    today = date.today()
    for pid, st in elos.items():
        if st['last_date']:
            gap = (today - st['last_date']).days
            if gap <= 730:
                # estimar contagem 24m a partir do count total (proxy: meio do count)
                st['count_24m'] = max(1, st['count'] // 2)

    return elos


def write_elos(elos: dict, idx: dict):
    """PATCH players com elo_doubles_*."""
    print('\n  ▸ writing ELOs to Supabase…')
    # Construir id → player_meta map a partir do idx
    id_to_player: dict[int, dict] = {}
    for plist in idx['by_full'].values():
        for p in plist:
            id_to_player[p['id']] = p

    rows = []
    for pid, st in elos.items():
        if st['count'] < 1:
            continue
        rows.append({
            'id': pid,
            'elo_doubles_overall': round(st['overall'], 1),
            'elo_doubles_hard':    round(st['hard'], 1) if st['hard'] != INITIAL_ELO else None,
            'elo_doubles_clay':    round(st['clay'], 1) if st['clay'] != INITIAL_ELO else None,
            'elo_doubles_grass':   round(st['grass'], 1) if st['grass'] != INITIAL_ELO else None,
            'doubles_matches':     st['count'],
            'doubles_matches_24m': st['count_24m'],
        })
    print(f'    {len(rows):,} players to PATCH')

    # Usa supa() com retry agressivo (8 tentativas, base 3s) — resilente
    # a falhas de DNS/network durante o batch enorme.
    ok = fail = 0
    for i, row in enumerate(rows, 1):
        pid = row.pop('id')
        try:
            status, _ = supa('PATCH', f'/players?id=eq.{pid}', body=row)
            if 200 <= status < 300:
                ok += 1
            else:
                fail += 1
                if fail <= 5:
                    print(f'    id={pid}: HTTP {status}')
        except Exception as e:
            fail += 1
            if fail <= 5:
                print(f'    id={pid}: {type(e).__name__}: {e!s}')
        if i % 500 == 0:
            print(f'    {i:,}/{len(rows):,}  (ok={ok}, fail={fail})')
    print(f'  ✅ {ok}/{len(rows)} updated  ·  {fail} fail')


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='Não escreve em Supabase')
    args = ap.parse_args()

    print('[1/3] Loading matches from CSVs…')
    matches = load_all_matches()
    print(f'  {len(matches):,} matches loaded from {DATA_DIR}')
    if not matches:
        sys.exit('No matches — corre primeiro o scrape_tennisexplorer_doubles.py')

    print('\n[2/4] Loading players from DB…')
    idx = fetch_all_players()

    # Pre-pass: insere todos os players novos em batches antes do training
    # (apenas no real run; dry-run usa fake IDs em memória)
    if not args.dry_run:
        prepare_missing_players(matches, idx)

    print('\n[3/4] Training…')
    elos = train(matches, idx, dry_run=args.dry_run)

    # Top 10 sample
    id_to_player = {p['id']: p for plist in idx['by_full'].values() for p in plist}
    top = sorted([
        (id_to_player[pid]['name'], st['overall'], st['count'])
        for pid, st in elos.items() if st['count'] >= 30 and pid in id_to_player
    ], key=lambda x: -x[1])[:15]
    print('\n  Top 15 doubles ELO (≥30 matches):')
    for name, elo, cnt in top:
        print(f'    {name:32s}  {elo:7.1f}   ({cnt:,} matches)')

    if args.dry_run:
        print('\n[4/4] DRY-RUN — não escreve.')
        return

    print('\n[4/4] Writing ELOs to Supabase…')
    write_elos(elos, idx)
    print('\nDONE.')


if __name__ == '__main__':
    main()
