import Link from 'next/link';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Calendário de Torneios 2026 · ATP, WTA, Slams',
  description:
    'Calendário completo de torneios ATP/WTA 2026. Resultados, vencedores, finalistas, prize money e previsões pelo modelo ELO. Slams, Masters 1000, ATP/WTA 500.',
  alternates: { canonical: '/torneios' },
};

interface Tournament {
  id: number;
  slug: string;
  name: string;
  full_name: string | null;
  year: number;
  tour: string;
  category: string | null;
  surface: string | null;
  flag: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  story: string | null;
  atp_winner_id: number | null;
  wta_winner_id: number | null;
}

async function fetchTournaments(): Promise<Tournament[]> {
  const { data } = await supabase
    .from('tournaments')
    .select('*')
    .order('start_date', { ascending: true });
  return data ?? [];
}

const SURFACE_CLASS = {
  clay: 'surface-clay',
  hard: 'surface-hard',
  grass: 'surface-grass',
  indoor: 'surface-indoor',
} as const;

const SURFACE_LABEL = {
  clay: 'Saibro',
  hard: 'Hard',
  grass: 'Grama',
  indoor: 'Indoor',
} as const;

const CAT_LABEL = {
  slam: '🏆 Grand Slam',
  '1000': 'Masters 1000',
  '500': 'ATP/WTA 500',
  '250': 'ATP 250',
  challenger: 'Challenger',
} as const;

const PT_MONTH = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export default async function TournamentsIndex() {
  const tournaments = await fetchTournaments();

  // Group by month
  const grouped = new Map<string, Tournament[]>();
  for (const t of tournaments) {
    if (!t.start_date) continue;
    const d = new Date(t.start_date);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = `${PT_MONTH[d.getMonth()]} ${d.getFullYear()}`;
    if (!grouped.has(monthKey)) grouped.set(monthKey, []);
    grouped.get(monthKey)!.push(t);
  }

  return (
    <>
      <Header />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          <h1 className="text-2xl md:text-3xl font-extrabold mb-2">Calendário de Torneios 2026</h1>
          <p className="text-gray-400 text-sm md:text-base mb-6 md:mb-8">
            ATP + WTA · {tournaments.length} torneios · resultados oficiais e previsões ELO
          </p>

          {/* Filtros (placeholders, futuros) */}
          <div className="flex gap-2 mb-6 flex-wrap text-xs">
            <button className="bg-[var(--color-accent)] text-[var(--color-surface)] px-3 py-2 rounded font-semibold">
              Todos ({tournaments.length})
            </button>
            <button className="bg-[var(--color-card)] border border-[var(--color-border)] px-3 py-2 rounded">
              🏆 Slams
            </button>
            <button className="bg-[var(--color-card)] border border-[var(--color-border)] px-3 py-2 rounded">
              M1000
            </button>
            <button className="bg-[var(--color-card)] border border-[var(--color-border)] px-3 py-2 rounded">
              500
            </button>
          </div>

          {/* Grouped by month */}
          <div className="space-y-8">
            {Array.from(grouped.entries()).map(([key, items]) => {
              const [, monthNum] = key.split('-');
              const label = `${PT_MONTH[parseInt(monthNum) - 1]} 2026`;
              return (
                <div key={key}>
                  <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-3">
                    {label}
                  </h2>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {items.map(t => {
                      const isLive = t.status === 'live';
                      const isUpcoming = t.status === 'scheduled';
                      const surfClass = t.surface ? SURFACE_CLASS[t.surface as keyof typeof SURFACE_CLASS] : '';
                      const surfLabel = t.surface ? SURFACE_LABEL[t.surface as keyof typeof SURFACE_LABEL] : '';
                      const catLabel = t.category ? CAT_LABEL[t.category as keyof typeof CAT_LABEL] : '';
                      const startDate = t.start_date ? new Date(t.start_date) : null;
                      const endDate = t.end_date ? new Date(t.end_date) : null;
                      const dateStr = startDate && endDate
                        ? `${startDate.getDate()}-${endDate.getDate()} ${PT_MONTH[startDate.getMonth()].slice(0, 3)}`
                        : '';
                      return (
                        <Link
                          key={t.id}
                          href={`/torneios/${t.slug}`}
                          className={`stat-card p-4 hover:border-[var(--color-accent)]/50 ${
                            isLive ? 'border-[var(--color-accent)]' : isUpcoming ? 'border-blue-500/40' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="text-2xl flex-shrink-0">{t.flag}</span>
                              <div className="min-w-0">
                                <div className="font-semibold truncate text-sm">{t.name}</div>
                                <div className="text-xs text-gray-500">{dateStr}</div>
                              </div>
                            </div>
                            {isLive && (
                              <span className="text-[10px] uppercase font-bold tracking-wider text-red-400 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                LIVE
                              </span>
                            )}
                            {isUpcoming && (
                              <span className="text-[10px] uppercase font-bold tracking-wider text-blue-400">
                                PRÓXIMO
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {surfLabel && <span className={`surface-pill ${surfClass}`}>{surfLabel}</span>}
                            <span className="text-xs text-gray-500">{catLabel}</span>
                          </div>
                          {t.story && (
                            <div className="text-xs text-gray-400 mt-2 line-clamp-2">
                              {t.story}
                            </div>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
