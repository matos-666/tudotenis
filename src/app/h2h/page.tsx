import Link from 'next/link';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { eloProb, buildMatchupSlug } from '@/lib/elo';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'H2H · Confrontos diretos · ATP/WTA',
  description:
    'Análise H2H entre 33 jogadores ATP/WTA. Probabilidades por superfície, comparação ELO e quotas justas. 528 confrontos analisados.',
  alternates: { canonical: '/h2h' },
};

interface Player {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  tour: string;
  elo_overall: number | null;
}

export default async function H2HIndexPage() {
  const { data: players } = await supabase
    .from('players')
    .select('id, slug, name, flag, tour, elo_overall')
    .eq('active', true)
    .order('elo_overall', { ascending: false })
    .limit(50);

  const list = (players ?? []) as Player[];
  const topAtp = list.filter(p => p.tour === 'atp').slice(0, 8);
  const topWta = list.filter(p => p.tour === 'wta').slice(0, 6);

  // Featured rivalries (matchups entre top 4 ATP + top 4 WTA)
  const featured: { p1: Player; p2: Player; prob1: number }[] = [];
  const top4Atp = topAtp.slice(0, 4);
  const top4Wta = topWta.slice(0, 4);
  for (const group of [top4Atp, top4Wta]) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const p1 = group[i];
        const p2 = group[j];
        const prob1 = eloProb(p1.elo_overall ?? 1500, p2.elo_overall ?? 1500);
        featured.push({ p1, p2, prob1 });
      }
    }
  }

  return (
    <>
      <Header />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          <h1 className="text-2xl md:text-3xl font-extrabold mb-2">H2H · Confrontos diretos</h1>
          <p className="text-gray-400 text-sm md:text-base mb-6 md:mb-8">
            528 confrontos analisados pelo modelo ELO · Probabilidades por superfície
          </p>

          {/* Featured rivalries */}
          <h2 className="text-xl font-bold mb-4">⚔️ Rivalidades em destaque</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-10">
            {featured.map(({ p1, p2, prob1 }) => (
              <Link
                key={`${p1.slug}-${p2.slug}`}
                href={`/h2h/${buildMatchupSlug(p1.slug, p2.slug)}`}
                className="stat-card p-4 hover:border-[var(--color-accent)]/50"
              >
                <div className="text-xs text-gray-500 mb-3 uppercase tracking-wider">
                  {p1.tour.toUpperCase()}
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-sm">
                    {p1.name} {p1.flag}
                  </div>
                  <div className={`font-mono text-sm font-bold ${prob1 >= 0.5 ? 'text-[var(--color-accent)]' : ''}`}>
                    {Math.round(prob1 * 100)}%
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm">
                    {p2.name} {p2.flag}
                  </div>
                  <div className={`font-mono text-sm font-bold ${prob1 < 0.5 ? 'text-[var(--color-accent)]' : ''}`}>
                    {Math.round((1 - prob1) * 100)}%
                  </div>
                </div>
                <div className="h-1 bg-[var(--color-border)] rounded-full mt-3 overflow-hidden flex">
                  <div className="bg-[var(--color-accent)]" style={{ width: `${prob1 * 100}%` }} />
                  <div className="bg-gray-600 flex-1" />
                </div>
              </Link>
            ))}
          </div>

          {/* Browse by player */}
          <h2 className="text-xl font-bold mb-4">Explorar por jogador</h2>
          <p className="text-sm text-gray-500 mb-4">
            Click num jogador para ver todos os confrontos H2H disponíveis.
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm uppercase tracking-wider text-gray-500 mb-3">ATP</h3>
              <div className="space-y-2">
                {topAtp.map(p => (
                  <Link
                    key={p.id}
                    href={`/jogador/${p.slug}`}
                    className="flex items-center justify-between bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/40 rounded-lg p-3 transition"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 text-sm">{p.flag}</span>
                      <span className="font-semibold">{p.name}</span>
                    </div>
                    <span className="font-mono text-xs text-gray-500">ELO {p.elo_overall}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm uppercase tracking-wider text-gray-500 mb-3">WTA</h3>
              <div className="space-y-2">
                {topWta.map(p => (
                  <Link
                    key={p.id}
                    href={`/jogador/${p.slug}`}
                    className="flex items-center justify-between bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/40 rounded-lg p-3 transition"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 text-sm">{p.flag}</span>
                      <span className="font-semibold">{p.name}</span>
                    </div>
                    <span className="font-mono text-xs text-gray-500">ELO {p.elo_overall}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
