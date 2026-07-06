import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AffiliateButtons } from '@/components/AffiliateButtons';
import { OddsCompareCTA } from '@/components/OddsCompareCTA';
import { supabase } from '@/lib/supabase';
import { hreflangAlternates, localizedHref, surfaceLabel, type Locale } from '@/lib/i18n';
import { buildMatchupSlug } from '@/lib/elo';
import { StarIcon, AlertTriangleIcon } from '@/components/icons';
import PlayerAvatar from '@/components/PlayerAvatar';

export const metadata: Metadata = {
  title: 'Picks do dia · ELO + Edge',
  description:
    'Picks de ténis publicados pelo modelo ELO TudoTénis. Yield comprovado +27,6% em 439 tips auditadas. Terra batida, hard, relvado. ATP, WTA e Challengers.',
  alternates: hreflangAlternates('/picks'),
};

export const revalidate = 600; // 10 min

// ── Types ─────────────────────────────────────────────────────────────────
interface Pick {
  id: number;
  player_id: number | null;
  market: string;
  selection: string;
  odd: number;
  edge_pct: number;
  grade: 'A' | 'B' | 'C';
  stake: number;
  result: 'win' | 'loss' | 'void' | null;
  pl: number | null;
  posted_at: string;
  settled_at: string | null;
  p1_name: string | null;
  p2_name: string | null;
  p1_flag: string | null;
  p2_flag: string | null;
  tournament_name: string | null;
  surface: string | null;
  scheduled_at: string | null;
  // Enriched at fetch time from players table:
  p1_photo_url?: string | null;
  p2_photo_url?: string | null;
  p1_slug?: string | null;
  p2_slug?: string | null;
  // Enriched: se o match está live agora, o sr_match_id do live_state
  // para o card linkar à página live com as picks ao vivo.
  live_sr_match_id?: number | null;
}

// Índice dos matches live agora (live_state_latest running=true), por
// par de nomes normalizado → sr_match_id. Usado para tornar os cards
// de /picks clicáveis para a página live quando o jogo está a decorrer.
// live_state usa formato SR 'Apelido, Nome'; picks usam 'Nome Apelido'.
function normName(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}
function srToNorm(srName: string): string {
  const idx = srName.indexOf(',');
  if (idx < 0) return normName(srName);
  return normName(`${srName.slice(idx + 1).trim()} ${srName.slice(0, idx).trim()}`);
}
function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}
async function fetchLiveMatchIndex(): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('live_state_latest')
    .select('sr_match_id, name_a, name_b, running, match_finished')
    .eq('running', true)
    .eq('match_finished', false)
    .limit(80);
  const idx = new Map<string, number>();
  for (const m of (data ?? []) as Array<{ sr_match_id: number; name_a: string | null; name_b: string | null }>) {
    if (!m.name_a || !m.name_b) continue;
    idx.set(pairKey(srToNorm(m.name_a), srToNorm(m.name_b)), m.sr_match_id);
  }
  return idx;
}
function attachLiveMatchId(picks: Pick[], liveIdx: Map<string, number>): Pick[] {
  if (liveIdx.size === 0) return picks;
  return picks.map(p => {
    if (!p.p1_name || !p.p2_name) return p;
    const id = liveIdx.get(pairKey(normName(p.p1_name), normName(p.p2_name)));
    return id != null ? { ...p, live_sr_match_id: id } : p;
  });
}

async function enrichWithPlayers(picks: Pick[]): Promise<Pick[]> {
  const names = new Set<string>();
  for (const p of picks) {
    if (p.p1_name) names.add(p.p1_name);
    if (p.p2_name) names.add(p.p2_name);
  }
  if (names.size === 0) return picks;

  const { data } = await supabase
    .from('players')
    .select('name, photo_url, slug')
    .in('name', Array.from(names));

  const byName = new Map<string, { photo_url: string | null; slug: string }>();
  for (const r of data ?? []) {
    byName.set(r.name, { photo_url: r.photo_url, slug: r.slug });
  }

  return picks.map(p => ({
    ...p,
    p1_photo_url: p.p1_name ? byName.get(p.p1_name)?.photo_url ?? null : null,
    p2_photo_url: p.p2_name ? byName.get(p.p2_name)?.photo_url ?? null : null,
    p1_slug:      p.p1_name ? byName.get(p.p1_name)?.slug      ?? null : null,
    p2_slug:      p.p2_name ? byName.get(p.p2_name)?.slug      ?? null : null,
  }));
}

// ── Data fetching ─────────────────────────────────────────────────────────
// Buscamos picks pelo scheduled_at do jogo, não pelo posted_at. Assim
// picks emitidas ontem para jogos de hoje/amanhã entram no display do
// dia correto. Janela [hoje 00:00, hoje+2d) cobre hoje + amanhã
// (renderizados em secções separadas na UI).
async function fetchTodayPicks(): Promise<Pick[]> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2)).toISOString();
  const { data, error } = await supabase
    .from('picks')
    .select('id, player_id, market, selection, odd, edge_pct, grade, stake, result, pl, posted_at, settled_at, p1_name, p2_name, p1_flag, p2_flag, tournament_name, surface, scheduled_at')
    .gte('scheduled_at', start)
    .lt('scheduled_at', end)
    .order('grade', { ascending: true })
    .order('edge_pct', { ascending: false });

  if (error) {
    console.error('[picks] today error:', error.message);
    return [];
  }
  return enrichWithPlayers((data ?? []) as Pick[]);
}

async function fetchYesterdayPicks(): Promise<Pick[]> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('picks')
    .select('id, player_id, market, selection, odd, edge_pct, grade, stake, result, pl, posted_at, settled_at, p1_name, p2_name, p1_flag, p2_flag, tournament_name, surface, scheduled_at')
    .gte('posted_at', `${yesterday}T00:00:00`)
    .lt('posted_at', `${yesterday}T23:59:59`)
    .not('result', 'is', null)
    .order('posted_at', { ascending: false });

  if (error) {
    console.error('[picks] yesterday error:', error.message);
    return [];
  }
  return enrichWithPlayers((data ?? []) as Pick[]);
}

// ── Doubles picks ─────────────────────────────────────────────────────────
interface DoublesPick {
  id: number;
  doubles_match_id: number;
  team_selected: 1 | 2;
  market: string;
  odd: number;
  edge_pct: number;
  grade: 'A' | 'B' | 'C';
  stake: number;
  result: 'win' | 'loss' | 'void' | null;
  pl: number | null;
  posted_at: string;
  settled_at: string | null;
  scheduled_at: string | null;
  tournament_name: string | null;
  surface: string | null;
  t1_p1_name: string | null;
  t1_p2_name: string | null;
  t2_p1_name: string | null;
  t2_p2_name: string | null;
  t1_p1_flag: string | null;
  t1_p2_flag: string | null;
  t2_p1_flag: string | null;
  t2_p2_flag: string | null;
  t1_p1_id: number | null;
  t1_p2_id: number | null;
  t2_p1_id: number | null;
  t2_p2_id: number | null;
  // Enriched at fetch time from players table:
  t1_p1_photo?: string | null;
  t1_p2_photo?: string | null;
  t2_p1_photo?: string | null;
  t2_p2_photo?: string | null;
}

// Fotos dos 4 jogadores da dupla via lookup por id — doubles_picks só
// guarda ids/nomes/flags, as fotos vivem em players.photo_url.
async function enrichDoublesWithPlayers(picks: DoublesPick[]): Promise<DoublesPick[]> {
  const ids = new Set<number>();
  for (const p of picks) {
    for (const id of [p.t1_p1_id, p.t1_p2_id, p.t2_p1_id, p.t2_p2_id]) {
      if (id != null) ids.add(id);
    }
  }
  if (ids.size === 0) return picks;
  const { data } = await supabase
    .from('players')
    .select('id, photo_url')
    .in('id', [...ids]);
  const photoById = new Map<number, string | null>();
  for (const r of (data ?? []) as Array<{ id: number; photo_url: string | null }>) {
    photoById.set(r.id, r.photo_url);
  }
  return picks.map(p => ({
    ...p,
    t1_p1_photo: p.t1_p1_id != null ? photoById.get(p.t1_p1_id) ?? null : null,
    t1_p2_photo: p.t1_p2_id != null ? photoById.get(p.t1_p2_id) ?? null : null,
    t2_p1_photo: p.t2_p1_id != null ? photoById.get(p.t2_p1_id) ?? null : null,
    t2_p2_photo: p.t2_p2_id != null ? photoById.get(p.t2_p2_id) ?? null : null,
  }));
}

async function fetchTodayDoublesPicks(): Promise<DoublesPick[]> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2)).toISOString();
  const { data, error } = await supabase
    .from('doubles_picks')
    .select('id, doubles_match_id, team_selected, market, odd, edge_pct, grade, stake, result, pl, posted_at, settled_at, scheduled_at, tournament_name, surface, t1_p1_name, t1_p2_name, t2_p1_name, t2_p2_name, t1_p1_flag, t1_p2_flag, t2_p1_flag, t2_p2_flag, t1_p1_id, t1_p2_id, t2_p1_id, t2_p2_id')
    .gte('scheduled_at', start)
    .lt('scheduled_at', end)
    .order('grade', { ascending: true })
    .order('edge_pct', { ascending: false });
  if (error) {
    console.error('[picks] doubles today error:', error.message);
    return [];
  }
  return enrichDoublesWithPlayers((data ?? []) as DoublesPick[]);
}

// Tennis raramente passa de 5h (mesmo BO5 em Slams). Se passou esse
// tempo desde o scheduled_at, o match acabou na prática mesmo que o
// settler diário (22:30 UTC) ainda não tenha marcado o result. Sem
// cap, picks apareciam como "Em curso" durante 12-24h pós-início.
const LIVE_WINDOW_MS = 5 * 60 * 60 * 1000;

function hasStartedDoubles(p: DoublesPick): boolean {
  if (!p.scheduled_at) return false;
  const t = new Date(p.scheduled_at).getTime();
  const now = Date.now();
  return t <= now && now - t < LIVE_WINDOW_MS;
}

// ── Helpers ───────────────────────────────────────────────────────────────
// Indoor → hard styling (não temos UI dedicada a indoor).
const SURFACE_CLASS  = { clay: 'surface-clay', hard: 'surface-hard', grass: 'surface-grass', indoor: 'surface-hard' } as const;

function surfaceKey(s: string | null): keyof typeof SURFACE_CLASS {
  if (s && s in SURFACE_CLASS) return s as keyof typeof SURFACE_CLASS;
  return 'hard';
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
}

/**
 * "Em curso" = começou mas ainda não há result (settler ainda não correu
 * ou settler não encontrou). Inclui jogos que estão a decorrer agora E
 * jogos que terminaram mas estão à espera do settler (cron 22:30 UTC).
 *
 * Tennis matches podem durar 5+ horas (Slams) e o nosso settler corre
 * apenas 1× por dia. Por isso não há limite superior — só pré-live ou
 * pós-início.
 */
function hasStarted(p: Pick): boolean {
  if (!p.scheduled_at) return false;
  const t = new Date(p.scheduled_at).getTime();
  const now = Date.now();
  return t <= now && now - t < LIVE_WINDOW_MS;
}

/**
 * Devolve a key de dia (YYYY-MM-DD em timezone Lisbon) do scheduled_at.
 * Usado para agrupar picks por dia no display.
 */
function dayKey(iso: string | null): string {
  if (!iso) return '0000-00-00';
  const d = new Date(iso);
  // Lisbon date-string via toLocaleDateString
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}

function dayLabel(key: string, locale: 'pt-PT' | 'pt-BR'): string {
  if (key === '0000-00-00') return locale === 'pt-BR' ? 'Sem data' : 'Sem data';
  // hoje / amanhã em timezone Lisbon
  const todayKey = (() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date());
  })();
  const tomorrowKey = (() => {
    const d = new Date(Date.now() + 86_400_000);
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(d);
  })();
  if (key === todayKey)    return locale === 'pt-BR' ? 'Hoje'   : 'Hoje';
  if (key === tomorrowKey) return locale === 'pt-BR' ? 'Amanhã' : 'Amanhã';
  // Formato longo: "Segunda · 29 jun"
  const d = new Date(key + 'T12:00:00Z');
  const weekday = new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Lisbon', weekday: 'long',
  }).format(d);
  const dayMonth = new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Lisbon', day: 'numeric', month: 'short',
  }).format(d);
  const capWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${capWeekday} · ${dayMonth}`;
}

function groupByDay<T extends { scheduled_at: string | null }>(picks: T[]): Array<{ key: string; label: string; picks: T[] }> {
  const groups = new Map<string, T[]>();
  for (const p of picks) {
    const k = dayKey(p.scheduled_at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  // Ordenado por key (YYYY-MM-DD ascendente)
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, picks]) => ({ key, label: '', picks }));
}

/** Alias mantido para retrocompatibilidade com o card. */
function isLive(p: Pick): boolean {
  return hasStarted(p);
}

// PlayerAvatar local foi substituído pelo componente partilhado em
// @/components/PlayerAvatar (com fallback robusto onError + iniciais
// sobre gradiente accent). Mantém-se a importação no topo deste ficheiro.

// ── Compact Pick Row (live + settled — sem CTAs) ─────────────────────────
function CompactPickRow({ p, locale }: { p: Pick; locale: Locale }) {
  const isBR = locale === 'pt-BR';
  const surf = surfaceKey(p.surface);
  const settled = p.result != null;
  const isWin  = p.result === 'win';
  const isLoss = p.result === 'loss';
  const isVoid = p.result === 'void';
  const time = formatTime(p.scheduled_at);

  const border = isWin
    ? 'border-[var(--color-accent)]/40'
    : isLoss
      ? 'border-red-500/40'
      : isVoid
        ? 'border-gray-500/40'
        : 'border-red-500/30';

  const h2hHref = p.p1_slug && p.p2_slug
    ? localizedHref(locale, `/h2h/${buildMatchupSlug(p.p1_slug, p.p2_slug)}`)
    : null;

  const content = (
    <>
      {/* Mobile: 2 linhas — tournament + status em cima, players e stats abaixo */}
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <div className="flex items-center gap-2 text-xs min-w-0 flex-1">
          <span className={`surface-pill text-[10px] py-0.5 ${SURFACE_CLASS[surf]}`}>
            {surf === 'indoor' ? 'Hard' : surfaceLabel(locale, surf)}
          </span>
          <span className="text-gray-500 truncate text-[11px]">{p.tournament_name ?? ''}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] shrink-0">
          {settled ? (
            <span className={`uppercase font-bold tracking-wider ${
              isWin ? 'text-[var(--color-accent)]'
              : isLoss ? 'text-red-400'
              : 'text-gray-500'
            }`}>
              {isWin ? '✓ Green' : isLoss ? '✗ Red' : '⊘ Void'}
            </span>
          ) : (
            <span className="uppercase font-bold tracking-wider text-red-400 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />
              LIVE
            </span>
          )}
          {time && !settled && <span className="text-gray-500">{time}</span>}
        </div>
      </div>

      {/* Players + stats em linha (mobile-friendly) */}
      <div className="flex items-center gap-2 text-sm">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <PlayerAvatar photoUrl={p.p1_photo_url} flag={p.p1_flag} name={p.p1_name ?? p.selection} size={24} />
          <span className={`truncate font-semibold ${
            isWin ? 'text-[var(--color-accent)]' : isLoss ? 'text-red-300' : ''
          }`}>
            {p.p1_name ?? p.selection}
          </span>
        </div>
        <span className="text-[9px] uppercase text-gray-600 shrink-0">vs</span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          <span className="truncate text-gray-400 text-right">{p.p2_name ?? '–'}</span>
          <PlayerAvatar photoUrl={p.p2_photo_url} flag={p.p2_flag} name={p.p2_name ?? ''} size={24} />
        </div>
      </div>

      {/* Rodapé: odd + EV/PL + grade — em coluna estreita */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border)] text-[11px] gap-2">
        <span className="text-gray-500 truncate">
          {p.market} <span className="text-[var(--color-accent)] font-mono">@{Number(p.odd).toFixed(2)}</span>
        </span>
        <span className="flex items-center gap-2">
          {settled ? (
            <span className={`font-bold font-mono ${
              (p.pl ?? 0) > 0 ? 'text-[var(--color-accent)]'
              : (p.pl ?? 0) < 0 ? 'text-red-400'
              : 'text-gray-500'
            }`}>
              {(p.pl ?? 0) > 0 ? '+' : ''}€{Math.abs(p.pl ?? 0).toFixed(0)}
            </span>
          ) : (
            <span className="font-bold text-[var(--color-accent)] font-mono">+{Number(p.edge_pct).toFixed(1)}%</span>
          )}
          <span className={`grade-${p.grade} px-1.5 py-0.5 rounded text-[10px] font-bold`}>{p.grade}</span>
        </span>
      </div>
    </>
  );

  return (
    <div className={`stat-card p-3 ${border} ${settled ? 'opacity-90' : ''}`}>
      {h2hHref ? (
        <Link href={h2hHref} className="block -m-3 p-3 rounded-[inherit] hover:bg-[var(--color-card)]/40 transition">
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}

// ── Doubles Pick Card ─────────────────────────────────────────────────────
function DoublesPickCard({ p, locale }: { p: DoublesPick; locale: Locale }) {
  const isBR = locale === 'pt-BR';
  const surf = surfaceKey(p.surface);
  const settled = p.result != null;
  const isWin  = p.result === 'win';
  const isLoss = p.result === 'loss';
  const isVoid = p.result === 'void';
  const live = !settled && hasStartedDoubles(p);
  const time = formatTime(p.scheduled_at);

  // Equipa escolhida + adversária
  const selT1 = p.team_selected === 1;
  const selName1 = selT1 ? p.t1_p1_name : p.t2_p1_name;
  const selName2 = selT1 ? p.t1_p2_name : p.t2_p2_name;
  const selFlag1 = selT1 ? p.t1_p1_flag : p.t2_p1_flag;
  const selFlag2 = selT1 ? p.t1_p2_flag : p.t2_p2_flag;
  const selPhoto1 = selT1 ? p.t1_p1_photo : p.t2_p1_photo;
  const selPhoto2 = selT1 ? p.t1_p2_photo : p.t2_p2_photo;
  const oppName1 = selT1 ? p.t2_p1_name : p.t1_p1_name;
  const oppName2 = selT1 ? p.t2_p2_name : p.t1_p2_name;
  const oppFlag1 = selT1 ? p.t2_p1_flag : p.t1_p1_flag;
  const oppFlag2 = selT1 ? p.t2_p2_flag : p.t1_p2_flag;
  const oppPhoto1 = selT1 ? p.t2_p1_photo : p.t1_p1_photo;
  const oppPhoto2 = selT1 ? p.t2_p2_photo : p.t1_p2_photo;

  const cardBorder = isWin
    ? 'border-[var(--color-accent)]/45 shadow-lg shadow-[var(--color-accent)]/10'
    : isLoss
      ? 'border-red-500/45 shadow-lg shadow-red-500/10'
      : isVoid
        ? 'border-gray-500/40'
        : live
          ? 'border-red-500/40 shadow-lg shadow-red-500/5'
          : '';

  return (
    <div className={`pick-card-3d p-4 md:p-5 relative ${cardBorder} ${settled ? 'opacity-90' : ''}`}>
      {settled && (
        <div className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider z-10 ${
          isWin ? 'bg-[var(--color-accent)] text-[var(--color-surface)]'
                : isLoss ? 'bg-red-500 text-white'
                : 'bg-gray-500 text-white'
        }`}>
          {isWin ? '✓ Green' : isLoss ? '✗ Red' : '⊘ Void'}
        </div>
      )}

      {/* Header: torneio + surface + time/status */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <span className="text-xs text-gray-500 truncate flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-card)] border border-[var(--color-border)] font-bold">
            DUPLAS
          </span>
          {p.tournament_name ?? 'ATP/WTA'}
        </span>
        <div className="flex gap-2 items-center">
          <span className={`surface-pill ${SURFACE_CLASS[surf]}`}>
            {surf === 'indoor' ? 'Hard' : surfaceLabel(locale, surf)}
          </span>
          {settled ? (
            <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
              {isBR ? 'Terminado' : 'Terminado'}
            </span>
          ) : live ? (
            <span className="text-[10px] uppercase font-bold tracking-wider text-red-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              LIVE
            </span>
          ) : (
            time && <span className="text-[10px] uppercase font-bold text-blue-400">⏱ {time}</span>
          )}
        </div>
      </div>

      {/* Equipa escolhida (destaque) vs adversária (cinza) */}
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-accent)] font-bold mb-1 inline-flex items-center gap-1">
          <StarIcon size={12} /> {isBR ? 'Nossa dupla' : 'Nossa dupla'}
        </div>
        <div className="flex items-center gap-2 mb-2">
          <PlayerAvatar photoUrl={selPhoto1} flag={selFlag1} name={selName1 ?? ""} size={24} />
          <span className={`font-semibold text-sm truncate ${isWin ? 'text-[var(--color-accent)]' : isLoss ? 'text-red-300' : ''}`}>
            {selName1}
          </span>
          <span className="text-gray-600">/</span>
          <PlayerAvatar photoUrl={selPhoto2} flag={selFlag2} name={selName2 ?? ''} size={24} />
          <span className={`font-semibold text-sm truncate ${isWin ? 'text-[var(--color-accent)]' : isLoss ? 'text-red-300' : ''}`}>
            {selName2}
          </span>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">vs</div>
        <div className="flex items-center gap-2">
          <PlayerAvatar photoUrl={oppPhoto1} flag={oppFlag1} name={oppName1 ?? ''} size={24} />
          <span className="text-gray-400 text-xs truncate">{oppName1}</span>
          <span className="text-gray-600">/</span>
          <PlayerAvatar photoUrl={oppPhoto2} flag={oppFlag2} name={oppName2 ?? ''} size={24} />
          <span className="text-gray-400 text-xs truncate">{oppName2}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-end justify-between pt-3 border-t border-[var(--color-border)]">
        <div>
          <div className="text-xs text-gray-500 mb-1">Aposta</div>
          <div className="font-semibold text-sm">{p.market}</div>
          <div className="text-xs">@ <span className="text-[var(--color-accent)] font-mono font-semibold">{Number(p.odd).toFixed(2)}</span></div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500 mb-1">{settled ? 'P&L' : 'EV'}</div>
          {settled ? (
            <div className={`font-bold font-mono ${(p.pl ?? 0) > 0 ? 'text-[var(--color-accent)]' : (p.pl ?? 0) < 0 ? 'text-red-400' : 'text-gray-500'}`}>
              {(p.pl ?? 0) > 0 ? '+' : ''}€{Math.abs(p.pl ?? 0).toFixed(0)}
            </div>
          ) : (
            <div className="font-bold text-[var(--color-accent)]">+{Number(p.edge_pct).toFixed(1)}%</div>
          )}
        </div>
        <span className={`grade-${p.grade} px-2 py-1 rounded text-xs font-bold`}>{p.grade}</span>
      </div>
    </div>
  );
}

// ── Pick Card ─────────────────────────────────────────────────────────────
function PickCard({ p, locale }: { p: Pick; locale: Locale }) {
  const isBR = locale === 'pt-BR';
  const live = isLive(p);
  const surf = surfaceKey(p.surface);
  const time = formatTime(p.scheduled_at);
  const settled = p.result != null; // win | loss | void
  const isWin  = p.result === 'win';
  const isLoss = p.result === 'loss';
  const isVoid = p.result === 'void';

  // Border / status colour priority: settled > live > upcoming
  const cardBorder = isWin
    ? 'border-[var(--color-accent)]/45 shadow-lg shadow-[var(--color-accent)]/10'
    : isLoss
      ? 'border-red-500/45 shadow-lg shadow-red-500/10'
      : isVoid
        ? 'border-gray-500/40'
        : live
          ? 'border-red-500/40 shadow-lg shadow-red-500/5'
          : '';

  // Match live agora (fonte: live_state)? → link para a página live com
  // as picks ao vivo, com prioridade sobre o H2H. É a fonte de verdade
  // mais fiável do que o `live` baseado em scheduled_at.
  const liveHref = p.live_sr_match_id != null
    ? localizedHref(locale, `/jogo/${p.live_sr_match_id}`)
    : null;

  // H2H link (se temos os 2 slugs)
  const h2hHref =
    p.p1_slug && p.p2_slug
      ? localizedHref(locale, `/h2h/${buildMatchupSlug(p.p1_slug, p.p2_slug)}`)
      : null;

  // Destino do card: live > h2h.
  const cardHref = liveHref ?? h2hHref;

  // Conteúdo principal do card (header + players + stats).
  // Se temos h2hHref, envolvemos num Link; senão, num <div>.
  const cardBodyContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <span className="text-xs text-gray-500 truncate">{p.tournament_name ?? 'ATP/WTA'}</span>
        <div className="flex gap-2 items-center">
          <span className={`surface-pill ${SURFACE_CLASS[surf]}`}>{surf === 'indoor' ? 'Hard' : surfaceLabel(locale, surf)}</span>
          {settled ? (
            <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
              {isBR ? 'Terminado' : 'Terminado'}
            </span>
          ) : live ? (
            <span className="text-[10px] uppercase font-bold tracking-wider text-red-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              LIVE
            </span>
          ) : (
            time && <span className="text-[10px] uppercase font-bold text-blue-400">⏱ {time}</span>
          )}
        </div>
      </div>

      {/* Players — side-by-side com foto */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5 md:gap-2 flex-1 min-w-0">
          <PlayerAvatar photoUrl={p.p1_photo_url} flag={p.p1_flag} name={p.p1_name ?? p.selection} size={32} />
          <span className={`font-semibold text-sm md:text-base truncate ${isWin ? 'text-[var(--color-accent)]' : isLoss ? 'text-red-300' : ''}`}>
            {p.p1_name ?? p.selection}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-gray-600 shrink-0">vs</span>
        <div className="flex items-center gap-1.5 md:gap-2 flex-1 min-w-0 justify-end">
          <span className="text-gray-400 text-sm md:text-base truncate">
            {p.p2_name ?? '–'}
          </span>
          <PlayerAvatar photoUrl={p.p2_photo_url} flag={p.p2_flag} name={p.p2_name ?? ''} size={32} />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-end justify-between pt-3 border-t border-[var(--color-border)] mb-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Aposta</div>
          <div className="font-semibold text-sm">{p.market}</div>
          <div className="text-xs">@ <span className="text-[var(--color-accent)] font-mono font-semibold">{Number(p.odd).toFixed(2)}</span></div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500 mb-1">{settled ? 'P&L' : 'EV'}</div>
          {settled ? (
            <div className={`font-bold font-mono ${(p.pl ?? 0) > 0 ? 'text-[var(--color-accent)]' : (p.pl ?? 0) < 0 ? 'text-red-400' : 'text-gray-500'}`}>
              {(p.pl ?? 0) > 0 ? '+' : ''}€{Math.abs(p.pl ?? 0).toFixed(0)}
            </div>
          ) : (
            <div className="font-bold text-[var(--color-accent)]">+{Number(p.edge_pct).toFixed(1)}%</div>
          )}
        </div>
        <span className={`grade-${p.grade} px-2 py-1 rounded text-xs font-bold`}>{p.grade}</span>
      </div>

      {/* Hint de destino do card */}
      {liveHref ? (
        <div className="text-[11px] text-red-400 hover:underline mb-1 inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
          {isBR ? 'Ver ao vivo + picks live →' : 'Ver ao vivo + picks live →'}
        </div>
      ) : h2hHref ? (
        <div className="text-[11px] text-[var(--color-accent)] hover:underline mb-1">
          {isBR ? 'Ver análise H2H →' : 'Ver análise H2H →'}
        </div>
      ) : null}
    </>
  );

  return (
    <div className={`pick-card-3d p-4 md:p-5 relative ${cardBorder} ${settled ? 'opacity-90' : ''}`}>
      {/* Status badge top-right corner for settled picks */}
      {settled && (
        <div
          className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider z-10 ${
            isWin
              ? 'bg-[var(--color-accent)] text-[var(--color-surface)]'
              : isLoss
                ? 'bg-red-500 text-white'
                : 'bg-gray-500 text-white'
          }`}
        >
          {isWin ? '✓ Green' : isLoss ? '✗ Red' : '⊘ Void'}
        </div>
      )}

      {/* Corpo clicável → /jogo live (prioridade) ou /h2h */}
      {cardHref ? (
        <Link
          href={cardHref}
          className="block -m-4 md:-m-5 p-4 md:p-5 rounded-[inherit] hover:bg-[var(--color-card)]/40 transition"
        >
          {cardBodyContent}
        </Link>
      ) : (
        <div>{cardBodyContent}</div>
      )}

      {/* CTAs / info — fora do Link para não conflitar com cliques internos */}
      <div className={cardHref ? 'mt-2' : ''}>
        {settled ? (
          <div className="text-center text-xs text-gray-500 py-2">
            {isBR ? 'Resultado já conhecido — pick fechado' : 'Resultado já conhecido — pick fechado'}
          </div>
        ) : liveHref ? (
          <Link
            href={liveHref}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-bold text-red-400 border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 transition"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            {isBR ? 'Acompanhar ao vivo + picks live' : 'Acompanhar ao vivo + picks live'}
          </Link>
        ) : live ? (
          <div className="text-center text-xs text-red-400 py-2 inline-flex items-center justify-center gap-1 w-full">
            <AlertTriangleIcon size={12} /> {isBR ? 'Em curso — modelo só aposta pré-live' : 'Em curso — modelo só aposta pré-live'}
          </div>
        ) : (
          <OddsCompareCTA seed={p.id} odd={Number(p.odd)} market={p.market} isBR={isBR} />
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default async function PicksPage({ locale = 'pt-PT' as Locale }: { locale?: Locale } = {}) {
  const isBR = locale === 'pt-BR';

  const [todayRaw, yesterday, todayDoubles, liveIdx] = await Promise.all([
    fetchTodayPicks(),
    fetchYesterdayPicks(),
    fetchTodayDoublesPicks(),
    fetchLiveMatchIndex(),
  ]);
  // Marca as picks cujo match está live agora com o sr_match_id, para o
  // card linkar à página live.
  const today = attachLiveMatchId(todayRaw, liveIdx);

  // Picks que já começaram (scheduled <= now) ficam "Em curso" só durante
  // a janela LIVE_WINDOW_MS. Para além disso assumimos que já acabaram e
  // omitimos do display até o settler diário marcar result — caso contrário
  // matches que claramente já acabaram apareciam como "Em curso" durante
  // 12-24h. Upcoming requer estrito-futuro (scheduled > now), não apenas
  // !isLive (que incluiria os já-passados sem result).
  const nowMs = Date.now();
  // Todas as picks de hoje que ainda não foram settled entram em
  // 'Por jogar' — inclui as que o scheduled_at já passou mas o
  // match ainda pode estar a decorrer ou o settler ainda não correu.
  // Antes filtrávamos por isFuture(scheduled_at), o que escondia 5 de
  // 6 picks assim que o horário do jogo passava; agora ficam visíveis
  // até serem marcadas com resultado. Cap superior continua a ser
  // gerido pelo LIVE_WINDOW_MS + filtro global de 'terminados'.
  const todaySettled = today.filter(p => p.result != null);
  const todayUpcoming = today.filter(p => p.result == null);

  const doublesSettled  = todayDoubles.filter(p => p.result != null);
  const doublesUpcoming = todayDoubles.filter(p => p.result == null);

  const upcomingCount = todayUpcoming.length;
  const settledCount = todaySettled.length;

  // Stats de hoje (settled)
  const todayWins = todaySettled.filter(p => p.result === 'win').length;
  const todayLoss = todaySettled.filter(p => p.result === 'loss').length;
  const todayPL   = todaySettled.reduce((s, p) => s + (p.pl ?? 0), 0);

  const ydayWins  = yesterday.filter(p => p.result === 'win').length;
  const ydayLoss  = yesterday.filter(p => p.result === 'loss').length;
  const ydayPL    = yesterday.reduce((s, p) => s + (p.pl ?? 0), 0);
  const ydayYield = yesterday.length > 0 ? (ydayPL / (yesterday.length * 10)) * 100 : 0;

  const noPicksToday = today.length === 0;
  const dateLocale = isBR ? 'pt-BR' : 'pt-PT';

  return (
    <>
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">

          {/* Hero */}
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-full px-3 py-1 text-xs mb-4 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
              {upcomingCount} {isBR ? 'por jogar' : 'por jogar'} · {settledCount} {isBR ? 'terminados' : 'terminados'}
            </div>
            <h1 className="text-2xl md:text-4xl font-extrabold mb-2">
              {isBR ? 'Palpites de hoje' : 'Picks de hoje'}
            </h1>
            <p className="text-gray-400 text-sm md:text-base mb-6">
              {isBR
                ? 'EV ≥ 5% · grades A/B/C · liquidação automática após cada jogo'
                : 'EV ≥ 5% · grades A/B/C · settlement automático após cada jogo'}
            </p>

            {/* Performance KPIs — histórico do modelo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">Yield total</div>
                <div className="text-xl md:text-2xl font-extrabold text-[var(--color-accent)] font-mono">+27,6%</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">P&amp;L acumulado</div>
                <div className="text-xl md:text-2xl font-extrabold text-[var(--color-accent)] font-mono">+€8.189</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">{isBR ? 'Tips totais' : 'Tips totais'}</div>
                <div className="text-xl md:text-2xl font-extrabold font-mono">439</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">{isBR ? 'Taxa de acerto' : 'Win rate'}</div>
                <div className="text-xl md:text-2xl font-extrabold font-mono">48,5%</div>
              </div>
            </div>
          </div>

          {/* Picks de hoje */}
          <h2 className="text-xl font-bold mb-1">
            {isBR ? 'Palpites' : 'Picks'} · {new Date().toLocaleDateString(dateLocale, { day: 'numeric', month: 'long' })}
          </h2>
          <p className="text-xs text-gray-500 mb-6">
            {isBR
              ? 'O modelo só publica antes do início do jogo. Picks em curso ou terminados ficam para histórico.'
              : 'O modelo só publica antes do início do jogo. Picks em curso ou terminados ficam para histórico.'}
          </p>

          {noPicksToday ? (
            <div className="stat-card p-8 text-center mb-12">
              <div className="text-3xl mb-3">⏳</div>
              <div className="font-semibold mb-1">
                {isBR ? 'Sem palpites publicados ainda' : 'Sem picks publicados ainda'}
              </div>
              <p className="text-xs text-gray-500">
                {isBR
                  ? <>O modelo analisa os jogos do dia às 06:30 UTC.<br />Volte mais tarde ou ative notificações.</>
                  : <>O modelo analisa os jogos do dia às 06:30 UTC.<br />Volta mais tarde ou ativa notificações.</>}
              </p>
            </div>
          ) : (
            <>
              {/* 1. POR JOGAR (pré-live) — agrupado por dia (hoje, amanhã, etc.) */}
              {todayUpcoming.length > 0 && (
                <section className="mb-10">
                  <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
                    <h3 className="text-base md:text-lg font-bold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-400" />
                      {isBR ? 'Por jogar' : 'Por jogar'}
                      <span className="text-xs text-gray-500 font-normal">({todayUpcoming.length})</span>
                    </h3>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">
                      {isBR ? 'Apostar antes do início' : 'Apostar antes do início'}
                    </span>
                  </div>
                  {groupByDay(todayUpcoming).map(group => (
                    <div key={group.key} className="mb-7 last:mb-0">
                      <h4 className="text-xs uppercase tracking-wider text-[var(--color-accent)] font-bold mb-3 flex items-baseline gap-2">
                        <span>{dayLabel(group.key, locale)}</span>
                        <span className="text-gray-500 font-normal normal-case tracking-normal">
                          · {group.picks.length} {isBR ? 'palpites' : 'picks'}
                        </span>
                      </h4>
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {group.picks.map(p => <PickCard key={p.id} p={p} locale={locale} />)}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* Live action mora em /ao-vivo (fonte: live_state.running). Aqui só
                  mostramos picks pré-live, que perdem actuabilidade quando o
                  match começa (casas fecham mercado pré-live). */}

              {/* ── DOUBLES PICKS — secção separada ───────────────────────── */}
              {todayDoubles.length > 0 && (
                <section className="border-t border-[var(--color-border)] pt-10 mt-2 mb-10">
                  <div className="mb-6">
                    <div className="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-accent)]/30 rounded-full px-3 py-1 text-xs mb-3">
                      <span className="text-[var(--color-accent)] font-bold">NOVO</span>
                      <span className="text-gray-400">Doubles ELO em produção</span>
                    </div>
                    <h2 className="text-xl font-bold mb-1">
                      {isBR ? 'Palpites de duplas' : 'Picks de duplas'}
                    </h2>
                    <p className="text-xs text-gray-500">
                      {isBR
                        ? 'ATP + WTA · ELO próprio team-level · 116K matches treinados'
                        : 'ATP + WTA · ELO próprio team-level · 116K matches treinados'}
                    </p>
                  </div>

                  {doublesUpcoming.length > 0 && (
                    <div className="mb-8">
                      <h3 className="text-base font-bold flex items-center gap-2 mb-4">
                        <span className="w-2 h-2 rounded-full bg-blue-400" />
                        {isBR ? 'Por jogar' : 'Por jogar'}
                        <span className="text-xs text-gray-500 font-normal">({doublesUpcoming.length})</span>
                      </h3>
                      {groupByDay(doublesUpcoming).map(group => (
                        <div key={group.key} className="mb-6 last:mb-0">
                          <h4 className="text-xs uppercase tracking-wider text-[var(--color-accent)] font-bold mb-3 flex items-baseline gap-2">
                            <span>{dayLabel(group.key, locale)}</span>
                            <span className="text-gray-500 font-normal normal-case tracking-normal">
                              · {group.picks.length} {isBR ? 'palpites' : 'picks'}
                            </span>
                          </h4>
                          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {group.picks.map(p => <DoublesPickCard key={p.id} p={p} locale={locale} />)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Live moved to /ao-vivo */}

                  {doublesSettled.length > 0 && (
                    <div>
                      <h3 className="text-base font-bold flex items-center gap-2 mb-4">
                        <span className="w-2 h-2 rounded-full bg-gray-500" />
                        {isBR ? 'Terminados hoje' : 'Terminados hoje'}
                        <span className="text-xs text-gray-500 font-normal">({doublesSettled.length})</span>
                      </h3>
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {doublesSettled.map(p => <DoublesPickCard key={p.id} p={p} locale={locale} />)}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* 3. TERMINADOS HOJE — com resultado green/red (compact) */}
              {todaySettled.length > 0 && (
                <section className="mb-12">
                  <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
                    <h3 className="text-base md:text-lg font-bold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-gray-500" />
                      {isBR ? 'Terminados hoje' : 'Terminados hoje'}
                      <span className="text-xs text-gray-500 font-normal">({todaySettled.length})</span>
                    </h3>
                    <div className="flex gap-3 text-xs">
                      <span><span className="text-[var(--color-accent)] font-bold">{todayWins}</span> <span className="text-gray-500">V</span></span>
                      <span><span className="text-red-400 font-bold">{todayLoss}</span> <span className="text-gray-500">D</span></span>
                      <span className={`font-bold font-mono ${todayPL >= 0 ? 'text-[var(--color-accent)]' : 'text-red-400'}`}>
                        {todayPL >= 0 ? '+' : ''}€{Math.abs(todayPL).toFixed(0)}
                      </span>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
                    {todaySettled.map(p => <CompactPickRow key={p.id} p={p} locale={locale} />)}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Resultados de ontem */}
          {yesterday.length > 0 && (
            <div className="border-t border-[var(--color-border)] pt-10 mb-10">
              <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-bold">{isBR ? 'Resultados · ontem' : 'Resultados · ontem'}</h2>
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="text-center">
                    <div className="text-xs text-gray-500">V-D</div>
                    <div className="font-bold">
                      <span className="win">{ydayWins}</span>-<span className="loss">{ydayLoss}</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Yield</div>
                    <div className="font-bold text-[var(--color-accent)]">
                      {ydayYield >= 0 ? '+' : ''}{ydayYield.toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">P&amp;L</div>
                    <div className={`font-bold ${ydayPL >= 0 ? 'text-[var(--color-accent)]' : 'loss'}`}>
                      {ydayPL >= 0 ? '+' : ''}€{Math.abs(ydayPL).toFixed(0)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="stat-card overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead className="bg-[var(--color-surface)]">
                    <tr className="text-gray-500 text-xs uppercase">
                      <th className="text-left p-2 md:p-4 font-medium">Jogador</th>
                      <th className="hidden sm:table-cell text-left p-4 font-medium">Adversário</th>
                      <th className="hidden xs:table-cell text-left p-2 md:p-4 font-medium">Aposta</th>
                      <th className="text-right p-2 md:p-4 font-medium">{isBR ? 'Odd' : 'Quota'}</th>
                      <th className="text-right p-2 md:p-4 font-medium">Resultado</th>
                      <th className="text-right p-2 md:p-4 font-medium">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {yesterday.map(p => (
                      <tr key={p.id} className="border-t border-[var(--color-border)]">
                        <td className="p-2 md:p-4 font-sans font-semibold">
                          <div className="flex items-center gap-2">
                            <PlayerAvatar photoUrl={p.p1_photo_url} flag={p.p1_flag} name={p.p1_name ?? p.selection} size={24} />
                            <span className="truncate">{p.p1_name ?? p.selection}</span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell p-4 font-sans text-gray-400">
                          <div className="flex items-center gap-2">
                            <PlayerAvatar photoUrl={p.p2_photo_url} flag={p.p2_flag} name={p.p2_name ?? ''} size={24} />
                            <span className="truncate">{p.p2_name ?? '–'}</span>
                          </div>
                        </td>
                        <td className="p-3 md:p-4 font-sans text-xs">{p.market}</td>
                        <td className="text-right p-3 md:p-4">{Number(p.odd).toFixed(2)}</td>
                        <td className="text-right p-3 md:p-4">
                          {p.result === 'win'  ? <span className="win">✓ WIN</span>
                           : p.result === 'loss' ? <span className="loss">✗ LOSS</span>
                           : <span className="void">⊘ VOID</span>}
                        </td>
                        <td className={`text-right p-3 md:p-4 ${(p.pl ?? 0) > 0 ? 'win' : (p.pl ?? 0) < 0 ? 'loss' : 'void'}`}>
                          {(p.pl ?? 0) > 0 ? `+€${Number(p.pl).toFixed(0)}` : (p.pl ?? 0) < 0 ? `-€${Math.abs(Number(p.pl)).toFixed(0)}` : '€0'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty yesterday state */}
          {yesterday.length === 0 && (
            <div className="border-t border-[var(--color-border)] pt-10 mb-10">
              <h2 className="text-xl font-bold mb-3">Resultados · ontem</h2>
              <p className="text-xs text-gray-500">
                {isBR
                  ? 'Sem palpites liquidados de ontem ainda. A liquidação corre automaticamente à meia-noite.'
                  : 'Sem picks liquidados de ontem ainda. A liquidação corre automaticamente à meia-noite.'}
              </p>
            </div>
          )}

          {/* CTA final */}
          <div className="stat-card p-6 md:p-8 border-[var(--color-accent)]/30 text-center">
            <h3 className="text-xl font-bold mb-2">{isBR ? 'Pronto para apostar?' : 'Pronto para apostar?'}</h3>
            <p className="text-sm text-gray-400 mb-5">
              {isBR
                ? 'Nossos palpites são publicados antes do fechamento das casas. Aproveite as melhores odds.'
                : 'Os nossos picks são publicados antes do fecho das casas. Aproveita as melhores quotas.'}
            </p>
            <div className="flex justify-center">
              <AffiliateButtons variant="full" prefix={isBR ? 'Abrir conta @' : 'Abrir conta @'} />
            </div>
            <p className="text-xs text-gray-600 mt-5">
              {isBR
                ? '+18 · Jogue com responsabilidade · Apostas envolvem risco de perda'
                : '+18 · Joga responsável · Apostas envolvem risco de perda'}
            </p>
          </div>

        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
