import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import AutoRefresh from '@/components/AutoRefresh';
import PlayerAvatar from '@/components/PlayerAvatar';
import { supabase } from '@/lib/supabase';
import { hreflangAlternates, type Locale } from '@/lib/i18n';
import { TennisBallIcon } from '@/components/icons';

export const revalidate = 20;

function formatTournamentName(slug: string | null): string {
  if (!slug) return '';
  const parts = slug.split('-');
  const last = parts[parts.length - 1];
  const isTour = /^(atp|wta|itf|chl)$/i.test(last);
  const tourLabel = isTour ? last.toUpperCase() : null;
  const restParts = isTour ? parts.slice(0, -1) : parts;
  const titled = restParts.map(p => {
    if (/^\d+$/.test(p)) return p;
    if (p.toLowerCase() === 'us') return 'US';
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }).join(' ');
  return tourLabel ? `${titled} · ${tourLabel}` : titled;
}

interface LivePick {
  sr_match_id: number;
  selection: 'A' | 'B' | string;
  grade: string | null;
  live_odd: number | null;
  edge_pct: number | null;
}

async function fetchOpenPicksFor(matchIds: number[]): Promise<Map<number, LivePick>> {
  if (matchIds.length === 0) return new Map();
  const { data } = await supabase
    .from('live_picks')
    .select('sr_match_id, selection, grade, live_odd, edge_pct, posted_at')
    .in('sr_match_id', matchIds)
    .is('result', null)
    .gt('edge_pct', 0)
    .order('edge_pct', { ascending: false });
  // 1 pick (a melhor EV) por match
  const out = new Map<number, LivePick>();
  for (const p of (data ?? []) as LivePick[]) {
    if (!out.has(p.sr_match_id)) out.set(p.sr_match_id, p);
  }
  return out;
}

interface PlayerLite {
  id: number;
  photo_url: string | null;
  flag: string | null;
  elo_overall: number | null;
  elo_set_grass: number | null;
  elo_set_clay: number | null;
  elo_set_hard: number | null;
  atp_rank: number | null;
  slug: string | null;
}
async function fetchPlayerInfo(ids: number[]): Promise<Map<number, PlayerLite>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('players')
    .select('id, photo_url, flag, elo_overall, elo_set_grass, elo_set_clay, elo_set_hard, atp_rank, slug, name')
    .in('id', ids);
  const out = new Map<number, PlayerLite>();
  for (const p of (data ?? []) as PlayerLite[]) out.set(p.id, p);
  return out;
}

// Fallback lookup por nome — quando sr_player_map não tem entrada para
// o SR team_id, player_a_id vem null e não encontramos foto pelo ID.
// Aqui pescamos por nome exacto na tabela players (que já normaliza
// "Apelido, Nome"), para garantir que TODOS os cards têm foto.
// Converte "Fucsovics, Marton" (formato Sportradar) → "Marton Fucsovics"
// (formato tabela players). Se não houver vírgula, devolve inalterado.
function srNameToPlayerName(src: string): string {
  const idx = src.indexOf(',');
  if (idx < 0) return src.trim();
  const last = src.slice(0, idx).trim();
  const first = src.slice(idx + 1).trim();
  return first && last ? `${first} ${last}` : src.trim();
}

async function fetchPlayersByName(names: string[]): Promise<Map<string, PlayerLite>> {
  // Keys guardadas: nome ORIGINAL (SR-style) → PlayerLite. A conversão
  // 'Last, First' → 'First Last' é feita apenas no query à players table.
  const originals = [...new Set(names.filter(Boolean))];
  if (originals.length === 0) return new Map();
  const converted = originals.map(srNameToPlayerName);
  const { data } = await supabase
    .from('players')
    .select('id, photo_url, flag, elo_overall, elo_set_grass, elo_set_clay, elo_set_hard, atp_rank, slug, name')
    .in('name', converted);
  const byConverted = new Map<string, PlayerLite & { name: string }>();
  for (const p of (data ?? []) as (PlayerLite & { name: string })[]) byConverted.set(p.name, p);
  const out = new Map<string, PlayerLite>();
  for (const orig of originals) {
    const conv = srNameToPlayerName(orig);
    const hit = byConverted.get(conv);
    if (hit) out.set(orig, hit);
  }
  return out;
}

interface LiveOdd { sr_match_id: number; odd_a: number | null; odd_b: number | null; source: string }
async function fetchLatestOddsFor(matchIds: number[]): Promise<Map<number, LiveOdd>> {
  if (matchIds.length === 0) return new Map();
  const { data } = await supabase
    .from('live_odds_history')
    .select('sr_match_id, odd_a, odd_b, source, captured_at')
    .in('sr_match_id', matchIds)
    .order('captured_at', { ascending: false });
  // Keep first (most recent) per match
  const out = new Map<number, LiveOdd>();
  for (const r of (data ?? []) as LiveOdd[]) {
    if (!out.has(r.sr_match_id)) out.set(r.sr_match_id, r);
  }
  return out;
}

function surfaceFromSlug(slug: string | null): 'grass' | 'clay' | 'hard' {
  if (!slug) return 'hard';
  const s = slug.toLowerCase();
  if (s.includes('wimbledon') || s.includes('grass') || s.includes('halle') || s.includes('queens')) return 'grass';
  if (s.includes('roland') || s.includes('clay') || s.includes('monte-carlo') || s.includes('madrid') || s.includes('rome')) return 'clay';
  return 'hard';
}

function eloForSurface(p: PlayerLite | undefined, surface: 'grass' | 'clay' | 'hard'): number | null {
  if (!p) return null;
  if (surface === 'grass') return p.elo_set_grass ?? p.elo_overall;
  if (surface === 'clay')  return p.elo_set_clay  ?? p.elo_overall;
  return p.elo_set_hard ?? p.elo_overall;
}

function surfaceLabel(surface: 'grass' | 'clay' | 'hard', locale: Locale): string {
  if (locale === 'pt-BR') {
    return surface === 'grass' ? 'grama' : surface === 'clay' ? 'saibro' : 'quadra dura';
  }
  return surface === 'grass' ? 'relva' : surface === 'clay' ? 'terra batida' : 'piso duro';
}

// Regras "os nossos critérios" — mesmos limites usados em maybeEmitPick:
// grade A (convicção ≥ 0.75), odd ∈ [1.25, 4.0], EV positivo.
// Só destacamos "VALOR" quando os 3 se verificam. Fora disto, o edge
// é ruído estatístico / arbitragem irrealizável — não vale a nossa
// chancela.
const ODD_MIN = 1.25;
const ODD_MAX = 4.0;
const GRADE_A_MIN_PROB = 0.75;

function isOurBet(prob: number | null, odd: number | null, ev: number | null): boolean {
  if (prob == null || odd == null || ev == null) return false;
  if (ev <= 0) return false;
  if (odd < ODD_MIN || odd > ODD_MAX) return false;
  if (prob < GRADE_A_MIN_PROB) return false;
  return true;
}

export const metadata: Metadata = {
  title: 'Ao vivo · Matches em curso',
  description: 'Lista de matches de ténis em curso agora, com a nossa probabilidade ELO e score actualizado a cada 20 segundos.',
  alternates: hreflangAlternates('/ao-vivo'),
};

interface LiveRow {
  sr_match_id: number;
  set_a: number; set_b: number;
  game_a: number; game_b: number;
  tiebreak: boolean;
  name_a: string | null; name_b: string | null;
  match_win_prob_a: number | null;
  point_importance: number | null;
  player_a_id: number | null;
  player_b_id: number | null;
  running: boolean;
  match_finished: boolean;
  captured_at: string;
  tournament_slug: string | null;
}

// Só consideramos "ao vivo" um match cuja última snapshot tem menos de
// FRESH_WINDOW_MS. O flag running=true fica stale na DB quando o cron
// pára entre janelas — sem este filtro mostrávamos matches de ontem
// como se fossem live. 5 min é generoso o suficiente para tolerar 1-2
// polls falhados sem esconder matches genuinamente activos.
const FRESH_WINDOW_MS = 5 * 60 * 1000;

async function fetchLiveMatches(): Promise<LiveRow[]> {
  const since = new Date(Date.now() - FRESH_WINDOW_MS).toISOString();
  const { data } = await supabase
    .from('live_state_latest')
    .select('sr_match_id, set_a, set_b, game_a, game_b, tiebreak, name_a, name_b, match_win_prob_a, point_importance, player_a_id, player_b_id, running, match_finished, captured_at, tournament_slug')
    .eq('running', true)
    .eq('match_finished', false)
    .gt('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(40);
  return ((data ?? []) as LiveRow[]).filter(m => m.name_a && m.name_b);
}

function MatchCard({ m, pick, playerA, playerB, odds, locale }: {
  m: LiveRow;
  pick: LivePick | undefined;
  playerA: PlayerLite | undefined;
  playerB: PlayerLite | undefined;
  odds: LiveOdd | undefined;
  locale: Locale;
}) {
  const probA = m.match_win_prob_a;
  const probB = probA != null ? 1 - probA : null;
  const favIsA = probA != null && probA >= 0.5;
  const score = `${m.set_a}-${m.set_b}`;
  const cur = m.tiebreak ? 'TB' : `${m.game_a}-${m.game_b}`;
  const surface = surfaceFromSlug(m.tournament_slug);
  const eloA = eloForSurface(playerA, surface);
  const eloB = eloForSurface(playerB, surface);
  const oddA = odds?.odd_a != null ? Number(odds.odd_a) : null;
  const oddB = odds?.odd_b != null ? Number(odds.odd_b) : null;
  const evA = probA != null && oddA != null ? +((probA * oddA - 1) * 100).toFixed(1) : null;
  const evB = probB != null && oddB != null ? +((probB * oddB - 1) * 100).toFixed(1) : null;
  const aQualifies = isOurBet(probA, oddA, evA);
  const bQualifies = isOurBet(probB, oddB, evB);
  const bestSide: 'A' | 'B' | null =
    aQualifies && bQualifies ? ((evA ?? 0) >= (evB ?? 0) ? 'A' : 'B') :
    aQualifies ? 'A' :
    bQualifies ? 'B' : null;
  const bestEv = bestSide === 'A' ? evA : bestSide === 'B' ? evB : null;
  const bestName = bestSide === 'A' ? m.name_a : bestSide === 'B' ? m.name_b : null;

  return (
    <Link
      href={`/jogo/${m.sr_match_id}`}
      className="pick-card-3d p-4 block group relative"
    >
      {bestEv != null && bestName && (
        <div className="absolute -top-2 left-4 z-10 inline-flex items-center gap-1 bg-[var(--color-accent)] text-[var(--color-surface)] rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider shadow-md">
          Valor +{bestEv.toFixed(1)}%
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 bg-red-500/15 border border-red-500/40 text-red-400 rounded-full px-2 py-0.5 text-[10px] font-semibold">
          <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />
          AO VIVO
        </span>
        <div className="flex items-baseline gap-2 flex-wrap justify-end">
          {m.tournament_slug && (
            <span className="text-[10px] text-gray-400 font-semibold tracking-wide">{formatTournamentName(m.tournament_slug)}</span>
          )}
          <span className="text-[9px] uppercase tracking-wider text-gray-500">{surfaceLabel(surface, locale)}</span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <div className="flex items-center gap-2 min-w-0 justify-end text-right">
          <div className="min-w-0">
            <div className={`text-sm truncate ${favIsA ? 'font-bold text-[var(--color-accent)]' : 'font-semibold text-gray-200'}`}>
              {m.name_a ?? '–'}
            </div>
            <div className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
              {eloA != null && <>ELO {Math.round(eloA)}</>}
              {playerA?.atp_rank != null && (
                <> · #{playerA.atp_rank}</>
              )}
            </div>
          </div>
          <PlayerAvatar photoUrl={playerA?.photo_url} flag={playerA?.flag ?? null} name={m.name_a ?? '–'} size={44} ring />
        </div>
        <div className="text-center font-mono shrink-0 px-1">
          <div className="text-xl font-extrabold tracking-wider">{score}</div>
          <div className="text-[10px] text-gray-500 whitespace-nowrap mt-0.5">{cur}</div>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <PlayerAvatar photoUrl={playerB?.photo_url} flag={playerB?.flag ?? null} name={m.name_b ?? '–'} size={44} ring />
          <div className="min-w-0">
            <div className={`text-sm truncate ${!favIsA && probA != null ? 'font-bold text-[var(--color-accent)]' : 'font-semibold text-gray-200'}`}>
              {m.name_b ?? '–'}
            </div>
            <div className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
              {eloB != null && <>ELO {Math.round(eloB)}</>}
              {playerB?.atp_rank != null && (
                <> · #{playerB.atp_rank}</>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--color-border)]/40 grid grid-cols-2 gap-2">
        <SidePanel
          name={m.name_a ?? '–'}
          probPct={probA != null ? Math.round(probA * 100) : null}
          odd={oddA}
          ev={evA}
          qualifies={aQualifies}
          isBest={bestSide === 'A'}
        />
        <SidePanel
          name={m.name_b ?? '–'}
          probPct={probB != null ? Math.round(probB * 100) : null}
          odd={oddB}
          ev={evB}
          qualifies={bQualifies}
          isBest={bestSide === 'B'}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-gray-500">
          {pick && pick.grade === 'A'
            ? <>Pick <span className="inline-block grade-A px-1 rounded text-[10px] font-bold">A</span> · {pick.selection === 'A' ? m.name_a : m.name_b} @{Number(pick.live_odd).toFixed(2)}</>
            : bestName
              ? <>Modelo vê edge no <span className="font-bold text-[var(--color-accent)]">{bestName}</span></>
              : <>Sem edge agora · abre para tracker + stats live</>
          }
        </span>
        <span className="text-[var(--color-accent)] font-semibold group-hover:underline whitespace-nowrap">Ver match →</span>
      </div>
    </Link>
  );
}

function SidePanel({ name, probPct, odd, ev, qualifies, isBest }: {
  name: string;
  probPct: number | null;
  odd: number | null;
  ev: number | null;
  qualifies: boolean;
  isBest: boolean;
}) {
  const shortName = name.split(',')[0].trim();
  return (
    <div
      className={`relative rounded-lg border p-3 transition ${
        isBest
          ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 shadow-inner'
          : 'border-[var(--color-border)]/60 bg-[var(--color-card)]/40'
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-gray-400 truncate mb-1.5">
        {shortName}
      </div>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-gray-500 leading-none mb-0.5">Odd</div>
          <div className="font-mono text-2xl font-extrabold leading-none tabular-nums">
            {odd != null ? odd.toFixed(2) : '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 leading-none mb-0.5">Modelo</div>
          <div className="font-mono text-sm font-bold leading-none tabular-nums text-gray-300">
            {probPct != null ? `${probPct}%` : '—'}
          </div>
        </div>
      </div>
      <div
        className={`mt-1 flex items-center justify-between rounded px-2 py-1 text-[11px] font-bold font-mono tabular-nums ${
          ev == null
            ? 'bg-[var(--color-border)]/20 text-gray-500'
            : qualifies
              ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
              : ev > 0
                ? 'bg-[var(--color-border)]/25 text-gray-400'
                : 'bg-red-500/10 text-red-400'
        }`}
      >
        <span className="text-[9px] uppercase tracking-wider opacity-80">EV</span>
        <span>{ev != null ? `${ev > 0 ? '+' : ''}${ev.toFixed(1)}%` : '—'}</span>
      </div>
    </div>
  );
}

export default async function AoVivoPage({ locale = 'pt-PT' as Locale }: { locale?: Locale } = {}) {
  const matches = await fetchLiveMatches();
  const matchIds = matches.map(m => m.sr_match_id);
  const playerIds = matches.flatMap(m => [m.player_a_id, m.player_b_id]).filter((x): x is number => x != null);
  const [picksByMatch, playersById, oddsByMatch] = await Promise.all([
    fetchOpenPicksFor(matchIds),
    fetchPlayerInfo(playerIds),
    fetchLatestOddsFor(matchIds),
  ]);

  // Fallback: para cada match onde não conseguimos player pelo ID
  // (sr_player_map sem entrada), pescamos por nome — evita cards com
  // avatares fallback quando o player existe na DB mas o mapa está em
  // falta.
  const namesToLookup: string[] = [];
  for (const m of matches) {
    if ((!m.player_a_id || !playersById.has(m.player_a_id)) && m.name_a) namesToLookup.push(m.name_a);
    if ((!m.player_b_id || !playersById.has(m.player_b_id)) && m.name_b) namesToLookup.push(m.name_b);
  }
  const playersByName = await fetchPlayersByName(namesToLookup);
  const resolvePlayer = (id: number | null, name: string | null): PlayerLite | undefined => {
    if (id != null) {
      const byId = playersById.get(id);
      if (byId) return byId;
    }
    if (name) return playersByName.get(name);
    return undefined;
  };
  return (
    <>
      <Header locale={locale} />
      <AutoRefresh intervalMs={25000} />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-full px-3 py-1 text-xs mb-3">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              {matches.length} {matches.length === 1 ? 'match' : 'matches'} em curso
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold mb-2">Ao vivo</h1>
            <p className="text-sm text-gray-400 max-w-2xl">
              Probabilidades ELO actualizadas a cada 20 segundos via Sportradar.
              Clica num match para ver tracker completo, stats live e a nossa modelagem
              detalhada.
            </p>
          </div>

          {matches.length === 0 ? (
            <div className="stat-card p-8 text-center">
              <TennisBallIcon size={36} className="mx-auto mb-3 text-[var(--color-accent)]" />
              <div className="font-semibold mb-1">Sem matches em curso agora</div>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                O cron de captação corre a cada minuto durante o dia. Volta dentro de momentos ou consulta os {' '}
                <Link href="/picks" className="text-[var(--color-accent)] hover:underline">picks de hoje</Link>.
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {matches.map(m => (
                <MatchCard
                  key={m.sr_match_id}
                  m={m}
                  pick={picksByMatch.get(m.sr_match_id)}
                  playerA={resolvePlayer(m.player_a_id, m.name_a)}
                  playerB={resolvePlayer(m.player_b_id, m.name_b)}
                  odds={oddsByMatch.get(m.sr_match_id)}
                  locale={locale}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
