import type { Metadata } from 'next';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Predictor } from '@/components/Predictor';

export const metadata: Metadata = {
  title: 'ELO Predictor · Probabilidade entre 2 jogadores',
  description:
    'Calcula a probabilidade de vitória entre quaisquer 2 jogadores ATP/WTA usando o modelo ELO. 4 superfícies · BO3/BO5 · quota justa · edge vs casa · distribuição Monte Carlo.',
  alternates: { canonical: '/ferramentas/predictor' },
};

export const revalidate = 3600;

export interface PredictorPlayer {
  slug: string;
  name: string;
  flag: string | null;
  tour: string;
  elo_overall: number | null;
  elo_hard: number | null;
  elo_clay: number | null;
  elo_grass: number | null;
  elo_indoor: number | null;
}

export default async function PredictorPage() {
  const { data } = await supabase
    .from('players')
    .select('slug, name, flag, tour, elo_overall, elo_hard, elo_clay, elo_grass, elo_indoor')
    .eq('active', true)
    .order('elo_overall', { ascending: false });

  const players = (data ?? []) as PredictorPlayer[];

  return (
    <>
      <Header />
      <main id="main" className="flex-1">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8">
          <div className="text-xs text-gray-500 mb-4">
            <Link href="/" className="hover:text-[var(--color-accent)]">Início</Link>
            <span className="mx-2">/</span>
            <Link href="/ferramentas" className="hover:text-[var(--color-accent)]">Ferramentas</Link>
            <span className="mx-2">/</span>
            <span>ELO Predictor</span>
          </div>

          <h1 className="text-2xl md:text-4xl font-extrabold mb-2">ELO Predictor</h1>
          <p className="text-gray-400 text-sm md:text-base mb-6 md:mb-8">
            Probabilidade entre quaisquer 2 jogadores · {players.length} jogadores ATP/WTA
          </p>

          <Predictor players={players} />
        </div>
      </main>
      <Footer />
    </>
  );
}
