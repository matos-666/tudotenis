import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { supabase } from '@/lib/supabase';
import { hreflangAlternates, type Locale } from '@/lib/i18n';

export const revalidate = 30;

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

async function fetchLiveMatches(): Promise<LiveRow[]> {
  const { data } = await supabase
    .from('live_state_latest')
    .select('sr_match_id, set_a, set_b, game_a, game_b, tiebreak, name_a, name_b, match_win_prob_a, point_importance, player_a_id, player_b_id, running, match_finished, captured_at, tournament_slug')
    .eq('running', true)
    .order('captured_at', { ascending: false })
    .limit(40);
  return (data ?? []) as LiveRow[];
}

function MatchCard({ m }: { m: LiveRow }) {
  const probA = m.match_win_prob_a;
  const probDisplay = probA != null ? `${Math.round(probA * 100)}%` : null;
  const favIsA = probA != null && probA >= 0.5;
  return (
    <Link
      href={`/jogo/${m.sr_match_id}`}
      className="stat-card p-4 hover:border-[var(--color-accent)]/50 transition block"
    >
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 bg-red-500/15 border border-red-500/40 text-red-400 rounded-full px-2 py-0.5 text-[10px] font-semibold">
          <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />
          AO VIVO
        </span>
        {m.tournament_slug && (
          <span className="text-[10px] text-gray-500">{m.tournament_slug.replace(/-/g, ' ')}</span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <div className={`text-sm truncate ${favIsA ? 'font-bold text-[var(--color-accent)]' : 'text-gray-300'}`}>
          {m.name_a ?? '–'}
        </div>
        <div className="text-center font-mono">
          <div className="text-lg font-extrabold">{m.set_a}-{m.set_b}</div>
          <div className="text-[10px] text-gray-500">{m.tiebreak ? 'TB' : `${m.game_a}-${m.game_b}`}</div>
        </div>
        <div className={`text-sm truncate text-right ${!favIsA && probA != null ? 'font-bold text-[var(--color-accent)]' : 'text-gray-300'}`}>
          {m.name_b ?? '–'}
        </div>
      </div>
      {probDisplay && (
        <div className="mt-3 text-[11px] text-gray-500 flex justify-between">
          <span>Modelo: <span className="font-mono text-gray-300">{Math.round(probA! * 100)}%</span></span>
          <span><span className="font-mono text-gray-300">{Math.round((1 - probA!) * 100)}%</span></span>
        </div>
      )}
    </Link>
  );
}

export default async function AoVivoPage({ locale = 'pt-PT' as Locale }: { locale?: Locale } = {}) {
  const matches = await fetchLiveMatches();
  return (
    <>
      <Header locale={locale} />
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
              <div className="text-3xl mb-3">🎾</div>
              <div className="font-semibold mb-1">Sem matches em curso agora</div>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                O cron de captação corre a cada minuto durante o dia. Volta dentro de momentos ou consulta os {' '}
                <Link href="/picks" className="text-[var(--color-accent)] hover:underline">picks de hoje</Link>.
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {matches.map(m => <MatchCard key={m.sr_match_id} m={m} />)}
            </div>
          )}
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
