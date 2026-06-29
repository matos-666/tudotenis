import type { Metadata } from 'next';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { TournamentsExplorer } from '@/components/TournamentsExplorer';
import { hreflangAlternates, type Locale } from '@/lib/i18n';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Calendário de Torneios · ATP, WTA, Slams, Masters 1000, ATP 250',
  description:
    'Calendário completo de torneios ATP/WTA. Resultados, vencedores, finalistas e previsões pelo modelo ELO. Slams, Masters 1000, ATP/WTA 500, ATP/WTA 250 e Challengers.',
  alternates: hreflangAlternates('/torneios'),
};

export interface TournamentLite {
  id: number;
  slug: string;
  name: string;
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
}

async function fetchTournaments(): Promise<TournamentLite[]> {
  // Apenas top categorias (sem challenger/davis para ficar gerível)
  const { data } = await supabase
    .from('tournaments')
    .select('id,slug,name,year,tour,category,surface,flag,location,start_date,end_date,status,story')
    .in('category', ['slam', '1000', '500', '250', 'finals'])
    .order('start_date', { ascending: false });
  return data ?? [];
}

export default async function TournamentsPage({ locale = 'pt-PT' as Locale }: { locale?: Locale } = {}) {
  const isBR = locale === 'pt-BR';
  const prefix = isBR ? '/br' : '';
  const tournaments = await fetchTournaments();
  return (
    <>
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          <h1 className="text-2xl md:text-3xl font-extrabold mb-2">Calendário de Torneios</h1>
          <p className="text-gray-400 text-sm md:text-base mb-6 md:mb-8">
            ATP + WTA · {tournaments.length} torneios · resultados oficiais e previsões ELO
          </p>

          {/* Quick links — insights ELO-driven */}
          <div className="grid sm:grid-cols-2 gap-3 mb-8">
            <Link
              href={`${prefix}/torneios/specialists`}
              className="stat-card p-4 hover:border-[var(--color-accent)]/40 transition group"
            >
              <div className="text-2xl mb-2">💎</div>
              <h3 className="font-bold mb-1 group-hover:text-[var(--color-accent)] transition">
                Specialists por surface
              </h3>
              <p className="text-xs text-gray-500">
                {isBR
                  ? 'Quem joga acima do nível overall em saibro, grama e hard.'
                  : 'Quem joga acima do nível overall em terra batida, relvado e hard.'}
              </p>
            </Link>
            <div className="stat-card p-4 opacity-60">
              <div className="text-2xl mb-2">🎯</div>
              <h3 className="font-bold mb-1">Próximo Slam: análise ELO</h3>
              <p className="text-xs text-gray-500">
                {isBR
                  ? 'Clica num torneio Slam ou Masters 1000 para ver preparação e predictor.'
                  : 'Clica num torneio Slam ou Masters 1000 para ver preparação e predictor.'}
              </p>
            </div>
          </div>

          <TournamentsExplorer tournaments={tournaments} locale={locale} />
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
