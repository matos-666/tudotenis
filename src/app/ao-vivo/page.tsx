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

interface PlayerLite { id: number; photo_url: string | null; flag: string | null }
async function fetchPlayerPhotos(ids: number[]): Promise<Map<number, PlayerLite>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('players')
    .select('id, photo_url, flag')
    .in('id', ids);
  const out = new Map<number, PlayerLite>();
  for (const p of (data ?? []) as PlayerLite[]) out.set(p.id, p);
  return out;
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

function MatchCard({ m, pick, photoA, photoB }: {
  m: LiveRow;
  pick: LivePick | undefined;
  photoA: PlayerLite | undefined;
  photoB: PlayerLite | undefined;
}) {
  const probA = m.match_win_prob_a;
  const favIsA = probA != null && probA >= 0.5;
  const score = `${m.set_a}-${m.set_b}`;
  const cur = m.tiebreak ? 'TB' : `${m.game_a}-${m.game_b}`;
  return (
    <Link
      href={`/jogo/${m.sr_match_id}`}
      className="pick-card-3d p-4 block group"
    >
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 bg-red-500/15 border border-red-500/40 text-red-400 rounded-full px-2 py-0.5 text-[10px] font-semibold">
          <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />
          AO VIVO
        </span>
        {m.tournament_slug && (
          <span className="text-[10px] text-gray-400 font-semibold tracking-wide">{formatTournamentName(m.tournament_slug)}</span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <div className="flex items-center gap-2 min-w-0 justify-end text-right">
          <div className="min-w-0">
            <div className={`text-sm truncate ${favIsA ? 'font-bold text-[var(--color-accent)]' : 'font-semibold text-gray-200'}`}>
              {m.name_a ?? '–'}
            </div>
            {probA != null && (
              <div className="text-[11px] font-mono text-gray-500">{Math.round(probA * 100)}%</div>
            )}
          </div>
          <PlayerAvatar photoUrl={photoA?.photo_url} flag={photoA?.flag ?? null} name={m.name_a ?? '–'} size={40} ring />
        </div>
        <div className="text-center font-mono shrink-0 px-1">
          <div className="text-xl font-extrabold tracking-wider">{score}</div>
          <div className="text-[10px] text-gray-500 whitespace-nowrap mt-0.5">{cur}</div>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <PlayerAvatar photoUrl={photoB?.photo_url} flag={photoB?.flag ?? null} name={m.name_b ?? '–'} size={40} ring />
          <div className="min-w-0">
            <div className={`text-sm truncate ${!favIsA && probA != null ? 'font-bold text-[var(--color-accent)]' : 'font-semibold text-gray-200'}`}>
              {m.name_b ?? '–'}
            </div>
            {probA != null && (
              <div className="text-[11px] font-mono text-gray-500">{Math.round((1 - probA) * 100)}%</div>
            )}
          </div>
        </div>
      </div>
      {pick && pick.live_odd != null && pick.edge_pct != null && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]/40 flex items-baseline justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">Pick activa</span>
          <span className="text-xs">
            <span className="font-bold">{pick.selection === 'A' ? m.name_a : m.name_b}</span>
            <span className="text-gray-500 font-mono"> @{Number(pick.live_odd).toFixed(2)}</span>
            <span className="text-[var(--color-accent)] font-bold font-mono"> · +{Number(pick.edge_pct).toFixed(1)}% EV</span>
            {pick.grade && <span className="ml-1.5 inline-block bg-[var(--color-accent)]/15 text-[var(--color-accent)] text-[10px] px-1.5 py-0.5 rounded font-bold">{pick.grade}</span>}
          </span>
        </div>
      )}
    </Link>
  );
}

export default async function AoVivoPage({ locale = 'pt-PT' as Locale }: { locale?: Locale } = {}) {
  const matches = await fetchLiveMatches();
  const [picksByMatch, photosById] = await Promise.all([
    fetchOpenPicksFor(matches.map(m => m.sr_match_id)),
    fetchPlayerPhotos(matches.flatMap(m => [m.player_a_id, m.player_b_id]).filter((x): x is number => x != null)),
  ]);
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
                  photoA={m.player_a_id ? photosById.get(m.player_a_id) : undefined}
                  photoB={m.player_b_id ? photosById.get(m.player_b_id) : undefined}
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
