#!/usr/bin/env python3
from __future__ import annotations
"""
TudoTénis – Fase 2: Gerador de Picks diário
============================================
Corre às 06:00 UTC via GitHub Actions (ver .github/workflows/daily_picks.yml)

Fluxo:
  1. Scrape https://tennisstats.com/ → jogos de hoje ainda por jogar
  2. Filtra ATP/WTA/Challenger singles (ignora ITF M15/W15 e duplas)
  3. Lê ELO de cada jogador do Supabase
  4. Calcula edge = ELO_prob − fair_implied_prob
  5. Insere picks com edge ≥ 5% na tabela `picks`

Dependências: apenas stdlib Python ≥ 3.9
"""

import os
import re
import sys
import json
import math
import datetime
import urllib.request
import urllib.error
import urllib.parse
import unicodedata
from html import unescape

# ── Config ────────────────────────────────────────────────────────────────
SUPABASE_URL  = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY  = os.environ.get("SUPABASE_SERVICE_KEY", "")
MIN_EDGE_PCT  = 5.0   # % mínimo de edge para publicar pick
MIN_ODD       = 1.15  # ignora quotas demasiado baixas
MAX_ODD       = 8.00  # ignora quotas demasiado altas (pouca liquidez)
TENNISSTATS_URL = "https://tennisstats.com/"
UA = "Mozilla/5.0 (compatible; TudoTenis/2.0)"

# Torneios para ignorar (ITF de baixo nível, W15, M15)
IGNORE_PATTERNS = [
    r"\bM15\b", r"\bW15\b", r"\bM25\b", r"\bW25\b",
    r"\bITF\b.*\bM\b", r"\bITF\b.*\bW\b",
]

# Mapeamento de superfície
SURFACE_MAP = {
    "clay": "clay", "saibro": "clay",
    "hard": "hard",
    "grass": "grass", "erva": "grass",
    "carpet": "indoor", "indoor": "indoor",
}

# Flags por país (heurística simples)
COUNTRY_FLAGS = {
    "italy": "🇮🇹", "spain": "🇪🇸", "france": "🇫🇷", "germany": "🇩🇪",
    "usa": "🇺🇸", "united states": "🇺🇸", "australia": "🇦🇺",
    "russia": "🇷🇺", "serbia": "🇷🇸", "czech republic": "🇨🇿",
    "poland": "🇵🇱", "switzerland": "🇨🇭", "greece": "🇬🇷",
    "norway": "🇳🇴", "argentina": "🇦🇷", "canada": "🇨🇦",
    "uk": "🇬🇧", "united kingdom": "🇬🇧", "turkey": "🇹🇷",
    "china": "🇨🇳", "japan": "🇯🇵", "brazil": "🇧🇷",
    "kazakhstan": "🇰🇿", "belarus": "🇧🇾", "denmark": "🇩🇰",
    "netherlands": "🇳🇱", "belgium": "🇧🇪", "croatia": "🇭🇷",
    "hungary": "🇭🇺", "romania": "🇷🇴", "portugal": "🇵🇹",
    "ukraine": "🇺🇦", "czech": "🇨🇿", "slovak": "🇸🇰",
    "austria": "🇦🇹", "sweden": "🇸🇪", "finland": "🇫🇮",
    "bulgaria": "🇧🇬", "georgia": "🇬🇪", "armenia": "🇦🇲",
    "south korea": "🇰🇷", "korea": "🇰🇷", "taiwan": "🇹🇼",
    "thailand": "🇹🇭", "india": "🇮🇳", "chile": "🇨🇱",
    "colombia": "🇨🇴", "mexico": "🇲🇽",
}

# ── Supabase helpers ───────────────────────────────────────────────────────

def _supa_req(endpoint: str, method: str = "GET", data: dict | None = None) -> list | dict:
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    req = urllib.request.Request(url, headers=headers, method=method)
    if data is not None:
        req.data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read()
            return json.loads(body) if body else []
    except urllib.error.HTTPError as e:
        print(f"  [Supabase {method}] {url} → {e.code}: {e.read().decode()[:200]}")
        return []
    except Exception as e:
        print(f"  [Supabase error] {e}")
        return []


def supa_get(endpoint: str) -> list:
    return _supa_req(endpoint, "GET") or []


def supa_post(table: str, row: dict) -> dict:
    return _supa_req(table, "POST", row) or {}


def supa_patch(table: str, filters: str, data: dict) -> list:
    return _supa_req(f"{table}?{filters}", "PATCH", data) or []

# ── Scraping TennisStats ──────────────────────────────────────────────────

def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        charset = r.headers.get_content_charset("utf-8")
        return raw.decode(charset, errors="replace")


def strip_tags(html: str) -> str:
    return unescape(re.sub(r"<[^>]+>", "", html)).strip()


def parse_surface(text: str) -> str:
    t = text.lower()
    for k, v in SURFACE_MAP.items():
        if k in t:
            return v
    return "hard"


def should_ignore(tournament_name: str) -> bool:
    for pat in IGNORE_PATTERNS:
        if re.search(pat, tournament_name, re.IGNORECASE):
            return True
    return False


def parse_matches(html: str) -> list[dict]:
    """
    Retorna lista de dicts com: p1_name, p2_name, p1_odd, p2_odd,
    tournament_name, surface, status (time string ou Fin./Ret./etc.)
    """
    matches = []

    # Split by match-list (each tournament block)
    blocks = re.split(r"<div class='match-list row cf", html)

    for block in blocks[1:]:  # skip first (before any match-list)
        # ── Skip doubles ──
        if "format-doubles" in block[:300]:
            continue
        if "dnone-important" in block[:300]:
            continue

        # ── Tournament name ──
        tn_m = re.search(r"<span class='semi-bold'>([^<]+)</span>", block)
        tournament_name = tn_m.group(1).strip() if tn_m else "Unknown"

        if should_ignore(tournament_name):
            continue

        # ── Surface ──
        surface_pills = re.findall(
            r"format-highlight small-highlight[^>]*>([^<]+)<", block
        )
        surface = "hard"
        for pill in surface_pills:
            s = pill.strip().lower()
            if s in SURFACE_MAP:
                surface = SURFACE_MAP[s]
                break

        # ── Country flag for tournament ──
        country_m = re.search(r"<span class='light-gray'> - ([^<]+)</span>", block)
        country = country_m.group(1).strip().lower() if country_m else ""
        tourn_flag = COUNTRY_FLAGS.get(country, "🎾")

        # ── Match rows ──
        # Each match-row contains two player rows (p1 + p2)
        for mr in re.finditer(
            r"<div class='match-row row cf (\w+)' >"
            r"<a href='(/h2h/[^']+)' class='row cf pr'[^>]*>(.*?)"
            r"</a></div>",
            block,
            re.DOTALL,
        ):
            match_html = mr.group(3)

            # Extract both player rows (padding:7px = p1, padding:3.5px = p2)
            rows = re.findall(
                r"padding:[37][^;]+;.*?"
                r"box2 bbox'>([^<]+)<.*?"
                r"box3 bbox ac'><span[^>]*>([^<]+)</span>",
                match_html,
                re.DOTALL,
            )
            if len(rows) < 2:
                continue

            p1_raw, p1_odd_str = rows[0]
            p2_raw, p2_odd_str = rows[1]

            p1_name = re.sub(r"\s*\(\d+\)\s*$", "", strip_tags(p1_raw)).strip()
            p2_name = re.sub(r"\s*\(\d+\)\s*$", "", strip_tags(p2_raw)).strip()

            # Odds
            try:
                p1_odd = float(p1_odd_str.strip())
            except ValueError:
                p1_odd = None
            try:
                p2_odd = float(p2_odd_str.strip())
            except ValueError:
                p2_odd = None

            # Status (live-box)
            status_m = re.search(
                r"live-box ac'><p[^>]*>([^<]+)</p>", match_html
            )
            status = status_m.group(1).strip() if status_m else ""

            # Time: upcoming matches show HH:MMpm / HH:MMam
            scheduled_at = parse_time(status)

            matches.append({
                "tournament_name": tournament_name,
                "tourn_flag": tourn_flag,
                "surface": surface,
                "p1_name": p1_name,
                "p2_name": p2_name,
                "p1_odd": p1_odd,
                "p2_odd": p2_odd,
                "status": status,
                "scheduled_at": scheduled_at,
                "h2h_slug": mr.group(2),
            })

    return matches


def parse_time(status: str) -> str | None:
    """Convert '10:30pm' → ISO datetime today UTC. Returns None if not a time."""
    m = re.match(r"(\d{1,2}):(\d{2})(am|pm)", status.lower().strip())
    if not m:
        return None
    h, mn, ampm = int(m.group(1)), int(m.group(2)), m.group(3)
    if ampm == "pm" and h != 12:
        h += 12
    elif ampm == "am" and h == 12:
        h = 0
    # TennisStats appears to use local Italian time (CEST = UTC+2) for Rome
    # Approximate: subtract 2h for UTC (good enough for scheduling)
    today = datetime.date.today()
    dt = datetime.datetime(today.year, today.month, today.day, h, mn)
    dt_utc = dt - datetime.timedelta(hours=2)
    return dt_utc.isoformat() + "Z"

# ── ELO helpers ───────────────────────────────────────────────────────────

def slugify(name: str) -> str:
    # Normalize unicode (e.g. ñ→n)
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    name = name.lower()
    name = re.sub(r"['\.]", "", name)
    name = re.sub(r"[^a-z0-9]+", "-", name)
    return name.strip("-")


_elo_cache: dict = {}


def get_player(name: str) -> dict | None:
    if name in _elo_cache:
        return _elo_cache[name]

    slug = slugify(name)
    rows = supa_get(
        f"players?slug=eq.{urllib.parse.quote(slug)}"
        f"&select=id,name,flag,elo_overall,elo_clay,elo_hard,elo_grass,elo_indoor"
    )
    if not rows:
        # Try ilike on name
        rows = supa_get(
            f"players?name=ilike.{urllib.parse.quote(name.replace(' ', '%'))}"
            f"&select=id,name,flag,elo_overall,elo_clay,elo_hard,elo_grass,elo_indoor"
            f"&limit=1"
        )
    player = rows[0] if rows else None
    _elo_cache[name] = player
    return player


def surface_elo(player: dict, surface: str) -> int:
    field = f"elo_{surface}" if surface in ("clay", "hard", "grass", "indoor") else "elo_overall"
    return player.get(field) or player.get("elo_overall") or 1500


def elo_win_prob(elo_a: int, elo_b: int) -> float:
    return 1.0 / (1.0 + 10.0 ** ((elo_b - elo_a) / 400.0))


def calc_edge(elo_prob: float, odd_pick: float, odd_opp: float) -> float:
    """
    Edge = ELO_prob − fair_implied_prob
    fair_implied_prob removes bookmaker margin
    """
    raw_pick = 1.0 / odd_pick
    raw_opp  = 1.0 / odd_opp
    total    = raw_pick + raw_opp
    fair_prob = raw_pick / total
    return (elo_prob - fair_prob) * 100.0  # as %


def grade(edge: float) -> str:
    if edge >= 12.0:
        return "A"
    if edge >= 8.0:
        return "B"
    return "C"

# ── Already posted today? ─────────────────────────────────────────────────

def picks_today() -> set[str]:
    today = datetime.date.today().isoformat()
    rows = supa_get(
        f"picks?posted_at=gte.{today}T00:00:00Z"
        f"&select=p1_name,p2_name,tournament_name"
    )
    return {f"{r['p1_name']}|{r['p2_name']}|{r['tournament_name']}" for r in rows}

# ── Main ──────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*60}")
    print(f"TudoTénis – Generate Picks  ({datetime.date.today()})")
    print(f"{'='*60}\n")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌  SUPABASE_URL / SUPABASE_SERVICE_KEY não definidos.")
        sys.exit(1)

    # 1. Scrape TennisStats
    print("📡  A fazer scrape de TennisStats…")
    try:
        html = fetch_html(TENNISSTATS_URL)
    except Exception as e:
        print(f"❌  Falha ao fazer scrape: {e}")
        sys.exit(1)

    all_matches = parse_matches(html)
    print(f"   {len(all_matches)} jogos encontrados no total")

    # 2. Filtrar apenas upcoming
    upcoming = [
        m for m in all_matches
        if m["scheduled_at"] is not None  # only matches with a future time
        or (m["status"] not in ("Fin.", "Ret.", "Canc.", "Walko.", "W.O.", "Serving", "")
            and m["status"])
    ]
    # Re-check: any with scheduled_at OR status looks like time
    upcoming = [
        m for m in all_matches
        if m["scheduled_at"] is not None or (
            re.match(r"\d{1,2}:\d{2}[ap]m", m["status"].lower()) and m["scheduled_at"] is not None
        )
    ]
    # Simple filter: status is NOT one of the terminal states
    terminal = {"Fin.", "Ret.", "Canc.", "Walko.", "W.O.", "Serving", "Susp.", ""}
    upcoming = [m for m in all_matches if m["status"] not in terminal]

    print(f"   {len(upcoming)} jogos por jogar hoje\n")

    if not upcoming:
        print("ℹ️   Sem jogos por jogar. Talvez seja cedo de mais ou tarde demais.")
        print("    Tudo bem — sem picks hoje.")
        sys.exit(0)

    # 3. Check which picks already exist today
    existing = picks_today()
    print(f"   {len(existing)} picks já publicados hoje\n")

    # 4. Analyze each match
    picks_inserted = 0
    market_pt = {"men": "Vencedor", "women": "Vencedora"}

    for m in upcoming:
        p1_name = m["p1_name"]
        p2_name = m["p2_name"]
        tourn   = m["tournament_name"]
        surface = m["surface"]

        # Skip if already posted
        key = f"{p1_name}|{p2_name}|{tourn}"
        key2 = f"{p2_name}|{p1_name}|{tourn}"
        if key in existing or key2 in existing:
            continue

        # Odds sanity check
        odd1 = m["p1_odd"]
        odd2 = m["p2_odd"]
        if odd1 is None or odd2 is None:
            continue
        if odd1 < MIN_ODD or odd2 < MIN_ODD:
            pass  # still evaluate, just note low odds
        if odd1 > MAX_ODD and odd2 > MAX_ODD:
            continue

        # Lookup ELO
        p1 = get_player(p1_name)
        p2 = get_player(p2_name)

        if p1 is None or p2 is None:
            missing = p1_name if p1 is None else p2_name
            print(f"  ⚠  Jogador não encontrado no DB: {missing}")
            continue

        elo1 = surface_elo(p1, surface)
        elo2 = surface_elo(p2, surface)

        prob1 = elo_win_prob(elo1, elo2)
        prob2 = 1.0 - prob1

        # Evaluate both sides
        for pick_player, opp_player, odd_pick, odd_opp, prob in [
            (p1, p2, odd1, odd2, prob1),
            (p2, p1, odd2, odd1, prob2),
        ]:
            if odd_pick is None or odd_opp is None:
                continue
            if odd_pick < MIN_ODD or odd_pick > MAX_ODD:
                continue

            edge = calc_edge(prob, odd_pick, odd_opp)

            if edge < MIN_EDGE_PCT:
                continue

            g = grade(edge)

            # Determine market label
            gender = "women" if "WTA" in tourn or "Women" in tourn or "W75" in tourn else "men"
            market = market_pt[gender]

            # Flag from DB or default
            pick_flag = pick_player.get("flag") or "🎾"
            opp_flag  = opp_player.get("flag") or "🎾"

            row = {
                "player_id":       pick_player["id"],
                "market":          market,
                "selection":       pick_player["name"],
                "odd":             odd_pick,
                "edge_pct":        round(edge, 2),
                "grade":           g,
                "stake":           10.0,
                "source":          "tennisstats",
                "p1_name":         pick_player["name"],
                "p2_name":         opp_player["name"],
                "p1_flag":         pick_flag,
                "p2_flag":         opp_flag,
                "tournament_name": tourn,
                "surface":         surface,
                "scheduled_at":    m["scheduled_at"],
            }

            result = supa_post("picks", row)
            if result:
                picks_inserted += 1
                print(
                    f"  ✅  {g}  {pick_player['name']} vs {opp_player['name']}"
                    f"  @ {odd_pick:.2f}  edge={edge:.1f}%  [{tourn} · {surface}]"
                )
            else:
                print(f"  ❌  Falha ao inserir pick: {pick_player['name']} vs {opp_player['name']}")

    print(f"\n{'='*60}")
    print(f"  {picks_inserted} pick(s) novos inseridos.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
