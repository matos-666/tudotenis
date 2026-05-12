import Link from 'next/link';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { getLocale, hreflangAlternates } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Ferramentas · ELO Predictor, Monte Carlo, Kelly',
  description:
    'Ferramentas grátis: ELO Predictor (probabilidade entre 2 jogadores), Simulador Monte Carlo (10k simulações), Calculadora Kelly (stake ótimo).',
  alternates: hreflangAlternates('/ferramentas'),
};

export default async function FerramentasIndex() {
  const locale = await getLocale();
  const isBR = locale === 'pt-BR';
  const prefix = isBR ? '/br' : '';

  const TOOLS = [
    {
      href: `${prefix}/ferramentas/predictor`,
      icon: '🎯',
      title: 'ELO Predictor',
      desc: isBR
        ? 'Probabilidade de vitória entre 2 jogadores · 4 pisos · BO3/BO5'
        : 'Probabilidade de vitória entre 2 jogadores · 4 superfícies · BO3/BO5',
      badge: '+ Monte Carlo',
    },
    {
      href: `${prefix}/ferramentas/kelly`,
      icon: '💰',
      title: isBR ? 'Calculadora Kelly' : 'Calculadora Kelly',
      desc: isBR
        ? 'Stake ótima por bankroll · slider de fração (cauteloso → agressivo)'
        : 'Stake ótimo por bankroll · slider de fração (cauteloso → agressivo)',
      badge: isBR ? 'Conservador 25%' : 'Conservador 25%',
    },
  ];

  return (
    <>
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-12">
          <h1 className="text-2xl md:text-4xl font-extrabold mb-2">{isBR ? 'Ferramentas grátis' : 'Ferramentas grátis'}</h1>
          <p className="text-gray-400 text-sm md:text-base mb-8">
            Modelo ELO próprio · 2.557 jogadores · totalmente funcional
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            {TOOLS.map(t => (
              <Link
                key={t.href}
                href={t.href}
                className="stat-card p-6 hover:border-[var(--color-accent)]/50 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="text-3xl">{t.icon}</div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2 py-1 rounded">
                    {t.badge}
                  </span>
                </div>
                <h2 className="font-bold text-lg mb-2">{t.title}</h2>
                <p className="text-sm text-gray-400 mb-4">{t.desc}</p>
                <div className="text-sm text-[var(--color-accent)] group-hover:underline">
                  Abrir →
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-10 stat-card p-6 border-[var(--color-accent)]/20">
            <h3 className="text-xs font-bold text-[var(--color-accent)] uppercase tracking-wider mb-2">
              Como funcionam
            </h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              {isBR
                ? 'Todas as ferramentas usam o nosso modelo ELO proprietário com 59k jogos analisados desde 1968. As probabilidades são calculadas com base em ELOs específicos por piso (Hard, Saibro, Grama) e ajustadas para best-of-3 ou best-of-5 (Slams).'
                : 'Todas as ferramentas usam o nosso modelo ELO proprietário com 59k jogos analisados desde 1968. As probabilidades são calculadas com base em ELOs específicos por superfície (Hard, Terra batida, Relvado) e ajustadas para best-of-3 ou best-of-5 (Slams).'}
            </p>
            <Link
              href={`${prefix}/como-funciona`}
              className="inline-block mt-3 text-sm text-[var(--color-accent)] hover:underline"
            >
              Saber mais sobre o modelo →
            </Link>
          </div>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
