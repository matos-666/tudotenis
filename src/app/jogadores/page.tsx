import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { supabase } from '@/lib/supabase';
import { getLocale, hreflangAlternates, localizedHref } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Jogadores · ATP, WTA, Challengers · TudoTénis',
  description:
    'Diretório completo de jogadores de ténis. ELO próprio, head-to-head, estatísticas por superfície. ATP, WTA, Challengers e ITF — em português.',
  alternates: hreflangAlternates('/jogadores'),
};

export const revalidate = 3600;

interface PlayerLite {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  tour: string;
  atp_rank: number | null;
  elo_overall: number | null;
  photo_url: string | null;
}

async function fetchPlayers(tour: 'atp' | 'wta'): Promise<PlayerLite[]> {
  const { data, error } = await supabase
    .from('players')
    .select('id, slug, name, flag, tour, atp_rank, elo_overall, photo_url')
    .eq('tour', tour)
    .eq('active', true)
    .order('elo_overall', { ascending: false });
  if (error) {
    console.error('[/jogadores] Supabase:', error.message);
    return [];
  }
  return data ?? [];
}

function PlayerCard({ p, locale }: { p: PlayerLite; locale: 'pt-PT' | 'pt-BR' }) {
  const initials = p.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const prefix = locale === 'pt-BR' ? '/br' : '';

  return (
    <Link
      href={`${prefix}/jogador/${p.slug}`}
      className="stat-card p-4 hover:border-[var(--color-accent)]/40 transition flex items-center gap-3 group"
    >
      <div className="relative w-12 h-12 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
        {p.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.photo_url}
            alt={p.name}
            loading="lazy"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'top center' }}
          />
        ) : (
          <span className="text-sm font-bold text-gray-500">{initials}</span>
        )}
        {/* Flag pequena, canto inferior-direito */}
        {p.flag && (
          <span
            className="absolute bottom-0 right-0 text-[10px] leading-none bg-[var(--color-surface)] rounded-tl px-0.5"
            aria-hidden="true"
          >
            {p.flag}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate group-hover:text-[var(--color-accent)] transition">
          {p.name}
        </div>
        <div className="text-xs text-gray-500">
          ELO <span className="font-mono text-[var(--color-accent)]">{p.elo_overall ?? '–'}</span>
          {p.atp_rank && <span> · #{p.atp_rank}</span>}
        </div>
      </div>
    </Link>
  );
}

export default async function JogadoresPage() {
  const locale = await getLocale();
  const isBR = locale === 'pt-BR';
  const [atp, wta] = await Promise.all([fetchPlayers('atp'), fetchPlayers('wta')]);
  const total = atp.length + wta.length;
  const rankingHref = localizedHref(locale, '/ranking');

  return (
    <>
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">

          <div className="mb-8">
            <div className="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-full px-3 py-1 text-xs mb-4">
              <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
              {total} jogadores · ELO atualizado diariamente
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold mb-3">Jogadores</h1>
            <p className="text-gray-400 text-sm md:text-base max-w-2xl">
              {isBR
                ? 'Perfis completos com ELO próprio por piso, forma recente, head-to-head e histórico. Clique em qualquer jogador para ver a página detalhada.'
                : 'Perfis completos com ELO próprio por superfície, forma recente, head-to-head e histórico. Clica em qualquer jogador para ver a página detalhada.'}
            </p>
          </div>

          {/* ATP */}
          <section className="mb-12">
            <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-xl md:text-2xl font-bold">ATP — Masculino</h2>
              <Link href={rankingHref} className="text-xs text-[var(--color-accent)] hover:underline">
                Ver ranking ELO completo →
              </Link>
            </div>
            {atp.length === 0 ? (
              <p className="text-sm text-gray-500">Sem dados disponíveis.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {atp.map(p => <PlayerCard key={p.id} p={p} locale={locale} />)}
              </div>
            )}
          </section>

          {/* WTA */}
          <section>
            <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-xl md:text-2xl font-bold">WTA — Feminino</h2>
              <Link href={rankingHref} className="text-xs text-[var(--color-accent)] hover:underline">
                Ver ranking ELO completo →
              </Link>
            </div>
            {wta.length === 0 ? (
              <p className="text-sm text-gray-500">Sem dados disponíveis.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {wta.map(p => <PlayerCard key={p.id} p={p} locale={locale} />)}
              </div>
            )}
          </section>

        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
