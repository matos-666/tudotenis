import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default function HomePage() {
  return (
    <>
      <Header />
      <main id="main" className="flex-1">
        <section className="border-b border-[var(--color-border)]">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-10 md:py-16">
            <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-full px-3 py-1 text-xs mb-5 flex-wrap">
                  <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse flex-shrink-0" />
                  Modelo atualizado · 1.059 jogadores · 40k+ jogos analisados
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight mb-5">
                  Picks ELO + <span className="text-[var(--color-accent)]">stats</span> que ninguém mais publica em português.
                </h1>
                <p className="text-base md:text-lg text-gray-400 mb-6 md:mb-8 leading-relaxed">
                  Modelo ELO próprio com 40k+ jogos analisados. Cobertura ATP, WTA, Challengers e ITF. Yield comprovado +30,4%.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link
                    href="/picks"
                    className="bg-[var(--color-accent)] text-[var(--color-surface)] px-5 py-3 rounded-lg font-semibold inline-block text-center"
                  >
                    Ver picks de hoje
                  </Link>
                  <Link
                    href="/ranking"
                    className="border border-[var(--color-border)] hover:border-[var(--color-accent)] px-5 py-3 rounded-lg font-semibold inline-block text-center"
                  >
                    Ranking ELO
                  </Link>
                </div>
              </div>
              <div className="stat-card p-6">
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-4">
                  Performance histórica
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-3xl font-extrabold text-[var(--color-accent)] font-mono">
                      +30,4%
                    </div>
                    <div className="text-xs text-gray-500">Yield total</div>
                  </div>
                  <div>
                    <div className="text-3xl font-extrabold font-mono">+€8.788</div>
                    <div className="text-xs text-gray-500">P&L (€1k bankroll)</div>
                  </div>
                  <div>
                    <div className="text-3xl font-extrabold font-mono">405</div>
                    <div className="text-xs text-gray-500">Tips resolvidas</div>
                  </div>
                  <div>
                    <div className="text-3xl font-extrabold font-mono">46,9%</div>
                    <div className="text-xs text-gray-500">Win rate</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 md:px-6 py-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Como o modelo funciona</h2>
          <p className="text-gray-400 mb-8 text-sm md:text-base">
            ELO próprio + edge contra as casas + grades A/B/C. Sem palpites, só matemática.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <Link href="/ranking" className="stat-card p-5 hover:border-[var(--color-accent)]/40 transition group">
              <div className="text-2xl mb-2">🏆</div>
              <h3 className="font-semibold mb-1 group-hover:text-[var(--color-accent)] transition">Ranking ELO</h3>
              <p className="text-xs text-gray-500">
                Classificação por força real — não por pontos ATP. Top 200 ATP + 200 WTA actualizado diariamente.
              </p>
            </Link>
            <Link href="/h2h" className="stat-card p-5 hover:border-[var(--color-accent)]/40 transition group">
              <div className="text-2xl mb-2">⚔️</div>
              <h3 className="font-semibold mb-1 group-hover:text-[var(--color-accent)] transition">H2H + Predictor</h3>
              <p className="text-xs text-gray-500">
                Probabilidade de vitória, score mais provável e Monte Carlo para qualquer confronto.
              </p>
            </Link>
            <Link href="/picks" className="stat-card p-5 hover:border-[var(--color-accent)]/40 transition group">
              <div className="text-2xl mb-2">💰</div>
              <h3 className="font-semibold mb-1 group-hover:text-[var(--color-accent)] transition">Picks com edge</h3>
              <p className="text-xs text-gray-500">
                Só quando o modelo encontra ≥5% de vantagem contra a quota da casa. Settlement automático.
              </p>
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
