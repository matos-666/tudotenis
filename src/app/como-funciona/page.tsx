import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { breadcrumbJsonLd, faqJsonLd } from '@/lib/jsonld';
import { getLocale, hreflangAlternates } from '@/lib/i18n';

const FAQ_ITEMS = [
  {
    question: 'É grátis?',
    answer:
      'Sim. Os picks, ranking e ferramentas são totalmente gratuitos. Sustentamo-nos com comissões de afiliação das casas de apostas — só ganhamos se abrires conta através dos nossos links, mas isso não te custa nada.',
  },
  {
    question: 'Quantos picks por dia?',
    answer:
      'Varia. Em semanas de Slam podem ser 5–10 picks/dia. Em semanas mortas podem ser 0. Não publicamos picks à força — só quando o modelo encontra valor real (edge ≥ 5% contra a quota das casas).',
  },
  {
    question: 'Que fonte de dados usam?',
    answer:
      'Histórico: dataset Jeff Sackmann (atp + wta GitHub repos), 59.312 jogos desde 2015. Quotas e fixtures: TennisStats.com em tempo real, com cron diário às 06:30 UTC.',
  },
  {
    question: 'Como funciona o modelo ELO?',
    answer:
      'Cada jogador tem 5 ratings ELO em paralelo: geral, hard, saibro, grama e indoor. Ao calcular um pick, usamos o ELO da superfície específica do jogo. K-factor varia por importância: Slam pesa 1,4× mais que Challenger; final pesa 1,3× mais que primeira ronda.',
  },
  {
    question: 'O que significa o grade A/B/C?',
    answer:
      'Grade A = edge ≥ 12% (máxima confiança, stake 2× normal). Grade B = edge 8-12% (sólido, stake normal). Grade C = edge 5-8% (marginal, stake 0,5×).',
  },
  {
    question: 'Posso confiar 100% nos picks?',
    answer:
      'Não. Aposta envolve sempre risco. O modelo tem edge a longo prazo (yield +27,6% em 439 tips auditados), mas a curto prazo a variância é alta. Aposta apenas o que podes perder.',
  },
];

export const metadata: Metadata = {
  title: 'Como funciona o modelo ELO TudoTénis · Metodologia',
  description:
    'Explicação completa do modelo ELO TudoTénis: como calculamos os ratings, como detectamos edge nas quotas, K-factor por superfície, grades A/B/C dos picks. Yield comprovado +27,6% em 439 tips.',
  alternates: hreflangAlternates('/como-funciona'),
};

export const revalidate = 86400; // 1 dia

export default async function ComoFuncionaPage() {
  const locale = await getLocale();
  const prefix = locale === 'pt-BR' ? '/br' : '';

  const breadcrumb = breadcrumbJsonLd([
    { name: 'Início',         href: `${prefix}/` },
    { name: 'Como funciona',  href: `${prefix}/como-funciona` },
  ]);
  const faq = faqJsonLd(FAQ_ITEMS);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }} />
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <article className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">

          <header className="mb-10">
            <div className="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-full px-3 py-1 text-xs mb-4">
              <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
              Metodologia
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold mb-3 leading-tight">
              Como funciona o modelo TudoTénis
            </h1>
            <p className="text-gray-400 text-base md:text-lg leading-relaxed">
              Sem palpites, sem inside info, sem &quot;feeling&quot;. Só matemática aplicada a 59k jogos
              de ténis ao longo de 10 anos. Aqui está exactamente o que fazemos.
            </p>
          </header>

          {/* Toc */}
          <nav className="stat-card p-4 mb-10 text-sm">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Nesta página</p>
            <ol className="space-y-1 list-decimal list-inside text-gray-300">
              <li><a href="#elo" className="hover:text-[var(--color-accent)]">O modelo ELO</a></li>
              <li><a href="#superficie" className="hover:text-[var(--color-accent)]">ELO por superfície</a></li>
              <li><a href="#picks" className="hover:text-[var(--color-accent)]">Como detectamos picks de valor</a></li>
              <li><a href="#grades" className="hover:text-[var(--color-accent)]">Grades A/B/C</a></li>
              <li><a href="#performance" className="hover:text-[var(--color-accent)]">Performance histórica</a></li>
              <li><a href="#faq" className="hover:text-[var(--color-accent)]">FAQ</a></li>
            </ol>
          </nav>

          {/* 1. ELO */}
          <section id="elo" className="mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">1. O modelo ELO</h2>
            <p className="text-gray-300 leading-relaxed mb-4">
              ELO é o mesmo sistema usado para classificar jogadores de xadrez. Cada jogador tem
              um rating numérico que sobe quando ganha e desce quando perde. A magnitude do
              ajuste depende de:
            </p>
            <ul className="space-y-2 text-gray-300 mb-4 list-disc list-inside">
              <li><strong>Quão favorito era o vencedor</strong> — bater o nº 1 vale mais que bater o nº 100.</li>
              <li><strong>Importância do torneio</strong> — Slam pesa 1,4× mais que um Challenger.</li>
              <li><strong>Ronda</strong> — final pesa 1,3× mais que primeira ronda.</li>
              <li><strong>Superfície</strong> — saibro, hard, grama e indoor têm ratings independentes.</li>
            </ul>
            <p className="text-gray-300 leading-relaxed">
              A fórmula é a clássica de Arpad Elo:
              <code className="block mt-3 p-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg text-sm font-mono overflow-x-auto">
                P(A vence B) = 1 / (1 + 10^((ELO_B − ELO_A) / 400))
              </code>
            </p>
          </section>

          {/* 2. Superfície */}
          <section id="superficie" className="mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">2. ELO por superfície</h2>
            <p className="text-gray-300 leading-relaxed mb-4">
              Nadal era o melhor saibrista da história mas tinha problemas em grama. Federer era
              quase imbatível em grama. Um modelo que não distinga superfícies <strong>perde
              estas nuances completamente</strong>.
            </p>
            <p className="text-gray-300 leading-relaxed mb-4">
              No TudoTénis, cada jogador tem 5 ratings ELO em paralelo:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
              {[
                { l: 'Geral', c: 'all' },
                { l: 'Saibro', c: 'clay' },
                { l: 'Hard', c: 'hard' },
                { l: 'Grama', c: 'grass' },
                { l: 'Indoor', c: 'indoor' },
              ].map(s => (
                <div key={s.l} className={`stat-card p-3 text-center surface-${s.c}`}>
                  <div className="text-xs text-gray-500 uppercase tracking-wider">{s.l}</div>
                </div>
              ))}
            </div>
            <p className="text-gray-300 leading-relaxed">
              Quando geramos um pick para um jogo em saibro, usamos o ELO de saibro — não o geral.
              Esta diferenciação é o factor principal do nosso edge.
            </p>
          </section>

          {/* 3. Picks */}
          <section id="picks" className="mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">3. Como detectamos picks de valor</h2>
            <p className="text-gray-300 leading-relaxed mb-4">
              O modelo só publica um pick quando a nossa probabilidade ELO é <strong>materialmente
              superior</strong> à probabilidade implícita na quota da casa.
            </p>
            <ol className="space-y-3 text-gray-300 mb-4 list-decimal list-inside">
              <li>Recolhemos as quotas de várias casas para cada jogo.</li>
              <li>Removemos a margem do bookmaker (overround).</li>
              <li>Comparamos com a probabilidade ELO calculada para a superfície específica.</li>
              <li>Se a diferença (edge) for ≥ 5%, o pick é publicado.</li>
              <li>Settlement automático após o jogo terminar.</li>
            </ol>
            <p className="text-gray-300 leading-relaxed">
              Tudo isto corre todos os dias às <strong>06:30 UTC</strong>, antes de muitas casas
              ajustarem as suas linhas. É por isso que recomendamos apostar logo de manhã.
            </p>
          </section>

          {/* 4. Grades */}
          <section id="grades" className="mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">4. Grades A/B/C</h2>
            <p className="text-gray-300 leading-relaxed mb-4">
              Cada pick recebe uma classificação que reflecte a confiança:
            </p>
            <div className="space-y-3 mb-4">
              <div className="stat-card p-4 flex items-start gap-4">
                <span className="grade-A px-3 py-1 rounded text-sm font-bold flex-shrink-0">A</span>
                <div>
                  <div className="font-semibold">Edge ≥ 12%</div>
                  <div className="text-xs text-gray-500">Picks de máxima confiança. Stake recomendada: 2× normal.</div>
                </div>
              </div>
              <div className="stat-card p-4 flex items-start gap-4">
                <span className="grade-B px-3 py-1 rounded text-sm font-bold flex-shrink-0">B</span>
                <div>
                  <div className="font-semibold">Edge 8–12%</div>
                  <div className="text-xs text-gray-500">Picks sólidos. Stake normal.</div>
                </div>
              </div>
              <div className="stat-card p-4 flex items-start gap-4">
                <span className="grade-C px-3 py-1 rounded text-sm font-bold flex-shrink-0">C</span>
                <div>
                  <div className="font-semibold">Edge 5–8%</div>
                  <div className="text-xs text-gray-500">Edge marginal. Stake reduzida (0,5×).</div>
                </div>
              </div>
            </div>
          </section>

          {/* 5. Performance */}
          <section id="performance" className="mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">5. Performance histórica</h2>
            <p className="text-gray-300 leading-relaxed mb-4">
              Em 439 tips resolvidos:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="stat-card p-4 text-center">
                <div className="text-2xl font-extrabold text-[var(--color-accent)] font-mono">+27,6%</div>
                <div className="text-xs text-gray-500">Yield total</div>
              </div>
              <div className="stat-card p-4 text-center">
                <div className="text-2xl font-extrabold font-mono">439</div>
                <div className="text-xs text-gray-500">Tips totais</div>
              </div>
              <div className="stat-card p-4 text-center">
                <div className="text-2xl font-extrabold font-mono">48,5%</div>
                <div className="text-xs text-gray-500">Win rate</div>
              </div>
              <div className="stat-card p-4 text-center">
                <div className="text-2xl font-extrabold font-mono">+€8.189</div>
                <div className="text-xs text-gray-500">P&amp;L acumulado</div>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Performance auditada. Todos os picks são publicados <em>antes</em> dos jogos
              começarem — sem retroatividade.
            </p>
          </section>

          {/* 6. FAQ */}
          <section id="faq" className="mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">6. Perguntas frequentes</h2>
            <div className="space-y-4">
              <details className="stat-card p-4">
                <summary className="font-semibold cursor-pointer">É grátis?</summary>
                <p className="text-gray-400 text-sm mt-2">
                  Sim. Os picks, ranking e ferramentas são totalmente gratuitos. Sustentamo-nos com
                  comissões de afiliação das casas de apostas — só ganhamos se tu abrires conta
                  através dos nossos links, mas isso não te custa nada.
                </p>
              </details>
              <details className="stat-card p-4">
                <summary className="font-semibold cursor-pointer">Quantos picks por dia?</summary>
                <p className="text-gray-400 text-sm mt-2">
                  Varia. Em semanas de Slam podem ser 5–10 picks/dia. Em semanas mortas (off-season,
                  exibições) podem ser 0. <strong>Não publicamos picks à força</strong> — só quando
                  o modelo encontra valor real.
                </p>
              </details>
              <details className="stat-card p-4">
                <summary className="font-semibold cursor-pointer">Que fonte de dados usam?</summary>
                <p className="text-gray-400 text-sm mt-2">
                  Histórico: dataset Jeff Sackmann (atp + wta GitHub repos), 59.312 jogos desde 2015.
                  Quotas e fixtures: TennisStats.com em tempo real.
                </p>
              </details>
              <details className="stat-card p-4">
                <summary className="font-semibold cursor-pointer">Posso confiar 100% nos picks?</summary>
                <p className="text-gray-400 text-sm mt-2">
                  Não. Aposta envolve sempre risco. O modelo tem edge a longo prazo, mas a curto
                  prazo a variância é alta. <strong>Aposta apenas o que podes perder</strong>.
                </p>
              </details>
            </div>
          </section>

          <div className="stat-card p-6 md:p-8 border-[var(--color-accent)]/30 text-center">
            <h3 className="text-xl font-bold mb-2">Pronto para experimentar?</h3>
            <p className="text-sm text-gray-400 mb-5">
              Vai aos picks de hoje, ou explora o ranking ELO para ver os melhores jogadores agora.
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              <Link
                href={`${prefix}/picks`}
                className="bg-[var(--color-accent)] text-[var(--color-surface)] px-5 py-3 rounded-lg font-semibold"
              >
                {locale === 'pt-BR' ? 'Palpites de hoje' : 'Picks de hoje'}
              </Link>
              <Link
                href={`${prefix}/ranking`}
                className="border border-[var(--color-border)] hover:border-[var(--color-accent)] px-5 py-3 rounded-lg font-semibold"
              >
                Ranking ELO
              </Link>
            </div>
          </div>

        </article>
      </main>
      <Footer locale={locale} />
    </>
  );
}
