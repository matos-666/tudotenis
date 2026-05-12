/**
 * Homepage component — used by both / (pt-PT) and /br (pt-BR).
 * Server component.
 */
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { localizedHref, type Locale } from '@/lib/i18n';

export function HomePage({ locale }: { locale: Locale }) {
  const isBR = locale === 'pt-BR';
  const lh = (href: string) => localizedHref(locale, href);

  return (
    <>
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <section className="border-b border-[var(--color-border)]">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-10 md:py-16">
            <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-full px-3 py-1 text-xs mb-5 flex-wrap">
                  <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse flex-shrink-0" />
                  {isBR
                    ? 'Modelo atualizado · 2.557 jogadores · 59k jogos analisados'
                    : 'Modelo actualizado · 2.557 jogadores · 59k jogos analisados'}
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight mb-5">
                  {isBR ? (
                    <>Palpites ELO + <span className="text-[var(--color-accent)]">stats</span> que ninguém mais publica em português.</>
                  ) : (
                    <>Picks ELO + <span className="text-[var(--color-accent)]">stats</span> que ninguém mais publica em português.</>
                  )}
                </h1>
                <p className="text-base md:text-lg text-gray-400 mb-6 md:mb-8 leading-relaxed">
                  {isBR
                    ? 'Modelo ELO próprio com 59k jogos analisados. Cobertura ATP, WTA, Challengers e ITF. Yield comprovado +27,6%.'
                    : 'Modelo ELO próprio com 59k jogos analisados. Cobertura ATP, WTA, Challengers e ITF. Yield comprovado +27,6%.'}
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link
                    href={lh('/picks')}
                    className="bg-[var(--color-accent)] text-[var(--color-surface)] px-5 py-3 rounded-lg font-semibold inline-block text-center"
                  >
                    {isBR ? 'Ver palpites de hoje' : 'Ver picks de hoje'}
                  </Link>
                  <Link
                    href={lh('/ranking')}
                    className="border border-[var(--color-border)] hover:border-[var(--color-accent)] px-5 py-3 rounded-lg font-semibold inline-block text-center"
                  >
                    Ranking ELO
                  </Link>
                </div>
              </div>
              <div className="stat-card p-6">
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-4">
                  {isBR ? 'Histórico de performance' : 'Performance histórica'}
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-3xl font-extrabold text-[var(--color-accent)] font-mono">+27,6%</div>
                    <div className="text-xs text-gray-500">Yield total</div>
                  </div>
                  <div>
                    <div className="text-3xl font-extrabold font-mono">+€8.189</div>
                    <div className="text-xs text-gray-500">{isBR ? 'P&L acumulado' : 'P&L acumulado'}</div>
                  </div>
                  <div>
                    <div className="text-3xl font-extrabold font-mono">439</div>
                    <div className="text-xs text-gray-500">{isBR ? 'Tips resolvidos' : 'Tips resolvidas'}</div>
                  </div>
                  <div>
                    <div className="text-3xl font-extrabold font-mono">48,5%</div>
                    <div className="text-xs text-gray-500">{isBR ? 'Taxa de acerto' : 'Win rate'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 md:px-6 py-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">{isBR ? 'Como o modelo funciona' : 'Como o modelo funciona'}</h2>
          <p className="text-gray-400 mb-8 text-sm md:text-base">
            {isBR
              ? 'ELO próprio + edge contra as casas + grades A/B/C. Sem palpite, só matemática.'
              : 'ELO próprio + edge contra as casas + grades A/B/C. Sem palpites, só matemática.'}
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <Link href={lh('/ranking')} className="stat-card p-5 hover:border-[var(--color-accent)]/40 transition group">
              <div className="text-2xl mb-2">🏆</div>
              <h3 className="font-semibold mb-1 group-hover:text-[var(--color-accent)] transition">Ranking ELO</h3>
              <p className="text-xs text-gray-500">
                {isBR
                  ? 'Classificação por força real — não por pontos ATP. Top 200 ATP + 200 WTA atualizado diariamente.'
                  : 'Classificação por força real — não por pontos ATP. Top 200 ATP + 200 WTA actualizado diariamente.'}
              </p>
            </Link>
            <Link href={lh('/h2h')} className="stat-card p-5 hover:border-[var(--color-accent)]/40 transition group">
              <div className="text-2xl mb-2">⚔️</div>
              <h3 className="font-semibold mb-1 group-hover:text-[var(--color-accent)] transition">H2H + Predictor</h3>
              <p className="text-xs text-gray-500">
                {isBR
                  ? 'Probabilidade de vitória, score mais provável e Monte Carlo para qualquer confronto.'
                  : 'Probabilidade de vitória, score mais provável e Monte Carlo para qualquer confronto.'}
              </p>
            </Link>
            <Link href={lh('/picks')} className="stat-card p-5 hover:border-[var(--color-accent)]/40 transition group">
              <div className="text-2xl mb-2">💰</div>
              <h3 className="font-semibold mb-1 group-hover:text-[var(--color-accent)] transition">
                {isBR ? 'Palpites com edge' : 'Picks com edge'}
              </h3>
              <p className="text-xs text-gray-500">
                {isBR
                  ? 'Só quando o modelo encontra ≥5% de vantagem contra a odd da casa. Liquidação automática.'
                  : 'Só quando o modelo encontra ≥5% de vantagem contra a quota da casa. Settlement automático.'}
              </p>
            </Link>
          </div>
        </section>
      </main>
      <Footer locale={locale} />
    </>
  );
}
