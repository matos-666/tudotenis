import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { KellyCalc } from '@/components/KellyCalc';
import { hreflangAlternates, type Locale } from '@/lib/i18n';
import { CoinsIcon } from '@/components/icons';

export const metadata: Metadata = {
  title: 'Calculadora Kelly · Stake ótimo por bankroll',
  description:
    'Calcula o stake ideal para cada aposta usando o critério de Kelly. Bankroll, quota da casa, probabilidade do modelo, fração Kelly (cauteloso → agressivo).',
  alternates: hreflangAlternates('/ferramentas/kelly'),
};

export default async function KellyPage({ locale = 'pt-PT' as Locale }: { locale?: Locale } = {}) {
  const isBR = locale === 'pt-BR';
  const prefix = isBR ? '/br' : '';

  return (
    <>
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 md:py-8">
          <div className="text-xs text-gray-500 mb-4">
            <Link href={`${prefix}/`} className="hover:text-[var(--color-accent)]">Início</Link>
            <span className="mx-2">/</span>
            <Link href={`${prefix}/ferramentas`} className="hover:text-[var(--color-accent)]">Ferramentas</Link>
            <span className="mx-2">/</span>
            <span>Calculadora Kelly</span>
          </div>

          <h1 className="text-2xl md:text-4xl font-extrabold mb-2 inline-flex items-center gap-2"><CoinsIcon size={32} className="text-[var(--color-accent)]" /> Calculadora Kelly</h1>
          <p className="text-gray-400 text-sm md:text-base mb-6 md:mb-8">
            {isBR
              ? 'Stake ótima por bankroll · combina probabilidade do modelo + odd da casa'
              : 'Stake ótimo por bankroll · combina probabilidade do modelo + quota da casa'}
          </p>

          <Suspense fallback={<div className="stat-card p-6">{isBR ? 'Carregando…' : 'A carregar…'}</div>}>
            <KellyCalc />
          </Suspense>

          <div className="mt-10 stat-card p-5 md:p-6">
            <h2 className="font-bold mb-3">Como funciona o Kelly</h2>
            <p className="text-sm text-gray-400 leading-relaxed mb-3">
              {isBR
                ? 'O critério de Kelly é uma fórmula matemática (1956) que calcula a fração ideal do bankroll a apostar para maximizar o crescimento do capital a longo prazo, dada uma probabilidade conhecida e odd da casa.'
                : 'O critério de Kelly é uma fórmula matemática (1956) que calcula a fração ideal do bankroll a apostar para maximizar o crescimento do capital a longo prazo, dada uma probabilidade conhecida e quota da casa.'}
            </p>
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 font-mono text-xs mb-3">
              f* = (b·p - q) / b<br />
              <span className="text-gray-500">
                {isBR ? 'onde b = odd - 1, p = probabilidade, q = 1 - p' : 'onde b = quota - 1, p = probabilidade, q = 1 - p'}
              </span>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">
              <strong className="text-gray-200">{isBR ? 'Recomendação:' : 'Recomendação:'}</strong>{' '}
              {isBR ? 'use ' : 'usa '}
              <span className="text-[var(--color-accent)]">25% (quarter Kelly)</span>{' '}
              {isBR ? 'ou menos. Full Kelly tem variância elevada e pode causar drawdowns significativos mesmo com edge real.' : 'ou menos. Full Kelly tem variância elevada e pode causar drawdowns significativos mesmo com edge real.'}
            </p>
          </div>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
