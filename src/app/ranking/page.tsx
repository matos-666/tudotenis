import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';
import { getLocale, hreflangAlternates, type Locale } from '@/lib/i18n';
import { displayElo } from '@/lib/elo';

export const metadata: Metadata = {
  title: 'Ranking ELO ATP/WTA · 2.557 jogadores',
  description:
    'Ranking ELO próprio para ATP e WTA. Atualizado diariamente com 59k jogos analisados. Veja os top 10 e os movers da semana.',
  alternates: hreflangAlternates('/ranking'),
};

// ISR: re-gera a cada hora (ou on-demand via revalidate)
export const revalidate = 3600;

interface Player {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  tour: string;
  atp_rank: number | null;
  elo_overall: number | null;
  elo_hard: number | null;
  elo_clay: number | null;
  elo_grass: number | null;
  elo_set_overall: number | null;
  elo_set_hard: number | null;
  elo_set_clay: number | null;
  elo_set_grass: number | null;
  elo_30d_ago: number | null;
  form_l5: string | null;
  photo_url: string | null;
}

function PlayerCell({ p, locale }: { p: Player; locale: Locale }) {
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
      className="flex items-center gap-2 md:gap-3 group min-w-0"
    >
      <div className="relative w-9 h-9 md:w-11 md:h-11 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
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
          <span className="text-[10px] md:text-xs font-bold text-gray-500">{initials}</span>
        )}
        {p.flag && (
          <span
            className="absolute bottom-0 right-0 text-[9px] md:text-[10px] leading-none bg-[var(--color-surface)] rounded-tl px-0.5"
            aria-hidden="true"
          >
            {p.flag}
          </span>
        )}
      </div>
      <span className="font-semibold truncate group-hover:text-[var(--color-accent)] transition">
        {p.name}
      </span>
    </Link>
  );
}

async function fetchTopPlayers(tour: 'atp' | 'wta', limit = 50): Promise<Player[]> {
  const { data, error } = await supabase
    .from('players')
    .select(
      'id, slug, name, flag, tour, atp_rank, elo_overall, elo_hard, elo_clay, elo_grass, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass, elo_30d_ago, form_l5, photo_url'
    )
    .eq('tour', tour)
    .eq('active', true)
    .order('elo_set_overall', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.error('Supabase error:', error.message);
    return [];
  }
  return data ?? [];
}

export default async function RankingPage() {
  const locale = await getLocale();
  const [atp, wta] = await Promise.all([
    fetchTopPlayers('atp', 10),
    fetchTopPlayers('wta', 10),
  ]);
  const isEmpty = atp.length === 0 && wta.length === 0;

  return (
    <>
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          <h1 className="text-2xl md:text-3xl font-extrabold mb-2">Ranking ELO</h1>
          <p className="text-gray-400 mb-6 md:mb-8 text-sm md:text-base">
            Modelo próprio · atualizado diariamente · cobertura ATP + WTA
          </p>

          {isEmpty && (
            <div className="stat-card p-6 mb-6 border-yellow-500/30">
              <h2 className="font-bold mb-2">⚠️ Base de dados vazia</h2>
              <p className="text-sm text-gray-400 mb-3">
                A tabela <code className="text-[var(--color-accent)]">players</code> está vazia. Aplica o schema SQL via Supabase Dashboard:
              </p>
              <ol className="text-sm text-gray-400 space-y-1 list-decimal pl-5">
                <li>Abre <a className="text-[var(--color-accent)] underline" href="https://supabase.com/dashboard/project/imcwzhvblvgjvkaljzdn/sql/new" target="_blank" rel="noopener">SQL Editor</a></li>
                <li>Cola o conteúdo de <code>/supabase/schema.sql</code></li>
                <li>Run · depois importa dados via cron ou seed</li>
              </ol>
            </div>
          )}

          {atp.length > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-bold mb-4">ATP · Top 10</h2>
              <div className="stat-card overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead className="bg-[var(--color-surface)]">
                    <tr className="text-gray-500 text-xs uppercase">
                      <th className="text-left p-3 md:p-4 font-medium">#</th>
                      <th className="text-left p-3 md:p-4 font-medium">Jogador</th>
                      <th className="text-right p-3 md:p-4 font-medium">ELO</th>
                      <th className="hidden md:table-cell text-right p-4 font-medium">Hard</th>
                      <th className="hidden md:table-cell text-right p-4 font-medium">Clay</th>
                      <th className="hidden md:table-cell text-right p-4 font-medium">Grass</th>
                      <th className="text-right p-3 md:p-4 font-medium">Δ 30d</th>
                      <th className="hidden sm:table-cell text-right p-3 md:p-4 font-medium">Forma</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {atp.map((p, idx) => {
                      const delta = p.elo_overall && p.elo_30d_ago ? p.elo_overall - p.elo_30d_ago : null;
                      return (
                        <tr key={p.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-card)]">
                          <td className="p-3 md:p-4 font-bold">{idx + 1}</td>
                          <td className="p-2 md:p-4 font-sans">
                            <PlayerCell p={p} locale={locale} />
                          </td>
                          <td className="text-right p-3 md:p-4 font-bold">{Math.round(displayElo(p.elo_set_overall) ?? p.elo_overall ?? 0) || '—'}</td>
                          <td className="hidden md:table-cell text-right p-4">{Math.round(displayElo(p.elo_set_hard)  ?? p.elo_hard  ?? 0) || '—'}</td>
                          <td className="hidden md:table-cell text-right p-4">{Math.round(displayElo(p.elo_set_clay)  ?? p.elo_clay  ?? 0) || '—'}</td>
                          <td className="hidden md:table-cell text-right p-4">{Math.round(displayElo(p.elo_set_grass) ?? p.elo_grass ?? 0) || '—'}</td>
                          <td className={`text-right p-3 md:p-4 ${delta && delta > 0 ? 'win' : delta && delta < 0 ? 'loss' : ''}`}>
                            {delta != null ? (delta > 0 ? `+${delta}` : delta) : '—'}
                          </td>
                          <td className="hidden sm:table-cell text-right p-3 md:p-4 text-xs">
                            {p.form_l5 ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {wta.length > 0 && (
            <section>
              <h2 className="text-xl font-bold mb-4">WTA · Top 10</h2>
              <div className="stat-card overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead className="bg-[var(--color-surface)]">
                    <tr className="text-gray-500 text-xs uppercase">
                      <th className="text-left p-3 md:p-4 font-medium">#</th>
                      <th className="text-left p-3 md:p-4 font-medium">Jogadora</th>
                      <th className="text-right p-3 md:p-4 font-medium">ELO</th>
                      <th className="hidden md:table-cell text-right p-4 font-medium">Hard</th>
                      <th className="hidden md:table-cell text-right p-4 font-medium">Clay</th>
                      <th className="hidden md:table-cell text-right p-4 font-medium">Grass</th>
                      <th className="text-right p-3 md:p-4 font-medium">Δ 30d</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {wta.map((p, idx) => {
                      const delta = p.elo_overall && p.elo_30d_ago ? p.elo_overall - p.elo_30d_ago : null;
                      return (
                        <tr key={p.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-card)]">
                          <td className="p-3 md:p-4 font-bold">{idx + 1}</td>
                          <td className="p-2 md:p-4 font-sans">
                            <PlayerCell p={p} locale={locale} />
                          </td>
                          <td className="text-right p-3 md:p-4 font-bold">{Math.round(displayElo(p.elo_set_overall) ?? p.elo_overall ?? 0) || '—'}</td>
                          <td className="hidden md:table-cell text-right p-4">{Math.round(displayElo(p.elo_set_hard)  ?? p.elo_hard  ?? 0) || '—'}</td>
                          <td className="hidden md:table-cell text-right p-4">{Math.round(displayElo(p.elo_set_clay)  ?? p.elo_clay  ?? 0) || '—'}</td>
                          <td className="hidden md:table-cell text-right p-4">{Math.round(displayElo(p.elo_set_grass) ?? p.elo_grass ?? 0) || '—'}</td>
                          <td className={`text-right p-3 md:p-4 ${delta && delta > 0 ? 'win' : delta && delta < 0 ? 'loss' : ''}`}>
                            {delta != null ? (delta > 0 ? `+${delta}` : delta) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
