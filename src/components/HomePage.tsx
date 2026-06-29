/**
 * Homepage component — used by both / (pt-PT) and /br (pt-BR).
 * Server component.
 */
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { localizedHref, type Locale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

async function fetchActiveSlam(): Promise<{
  atpSlug: string;
  wtaSlug: string;
  name: string;
  surface: string;
  startISO: string;
  endISO: string;
} | null> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const windowAhead = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('tournaments')
    .select('slug, name, surface_label, start_date, end_date, tour')
    .eq('category', 'slam')
    .gte('end_date', todayIso)
    .lte('start_date', windowAhead)
    .order('start_date', { ascending: true })
    .limit(4);
  if (!data || data.length === 0) return null;
  const atp = data.find(t => t.tour === 'atp');
  const wta = data.find(t => t.tour === 'wta');
  if (!atp || !wta) return null;
  return {
    atpSlug: atp.slug,
    wtaSlug: wta.slug,
    name: atp.name,
    surface: atp.surface_label ?? '',
    startISO: atp.start_date,
    endISO: atp.end_date,
  };
}

export async function HomePage({ locale }: { locale: Locale }) {
  const isBR = locale === 'pt-BR';
  const lh = (href: string) => localizedHref(locale, href);
  const slam = await fetchActiveSlam();

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
                    : 'Modelo atualizado · 2.557 jogadores · 59k jogos analisados'}
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

        {slam && (
          <section className="border-b border-[var(--color-border)] bg-gradient-to-br from-[var(--color-card)] to-transparent">
            <div className="max-w-7xl mx-auto px-4 md:px-6 py-10 md:py-12">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/40 text-[var(--color-accent)] rounded-full px-2.5 py-1 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                  GRAND SLAM EM CURSO
                </span>
                <span className="text-xs text-gray-500">{slam.surface}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold mb-2">
                {slam.name} {new Date(slam.startISO).getUTCFullYear()}
              </h2>
              <p className="text-sm md:text-base text-gray-400 mb-6 max-w-2xl">
                {isBR
                  ? `Predictor, draw, top favoritos e palpites diários gerados pelo modelo ELO TudoTênis. ATP + WTA, ronda a ronda.`
                  : `Predictor, draw, top favoritos e picks diários gerados pelo modelo ELO TudoTénis. ATP + WTA, ronda a ronda.`}
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Link href={lh(`/torneios/${slam.atpSlug}/predictor`)} className="stat-card p-4 hover:border-[var(--color-accent)]/50 transition group">
                  <div className="text-xs text-gray-500 mb-1">ATP</div>
                  <div className="font-semibold group-hover:text-[var(--color-accent)] transition">Predictor</div>
                  <div className="text-[11px] text-gray-500 mt-1">{isBR ? 'Probabilidade de cada favorito vencer o slam' : 'Probabilidade de cada favorito vencer o slam'}</div>
                </Link>
                <Link href={lh(`/torneios/${slam.atpSlug}/preparacao`)} className="stat-card p-4 hover:border-[var(--color-accent)]/50 transition group">
                  <div className="text-xs text-gray-500 mb-1">ATP</div>
                  <div className="font-semibold group-hover:text-[var(--color-accent)] transition">{isBR ? 'Preparação' : 'Preparação'}</div>
                  <div className="text-[11px] text-gray-500 mt-1">{isBR ? 'Specialists ocultos + vulneráveis no piso' : 'Specialists ocultos + vulneráveis no piso'}</div>
                </Link>
                <Link href={lh(`/torneios/${slam.wtaSlug}/predictor`)} className="stat-card p-4 hover:border-[var(--color-accent)]/50 transition group">
                  <div className="text-xs text-gray-500 mb-1">WTA</div>
                  <div className="font-semibold group-hover:text-[var(--color-accent)] transition">Predictor</div>
                  <div className="text-[11px] text-gray-500 mt-1">{isBR ? 'Probabilidade de cada favorita vencer o slam' : 'Probabilidade de cada favorita vencer o slam'}</div>
                </Link>
                <Link href={lh('/picks')} className="stat-card p-4 hover:border-[var(--color-accent)]/50 transition group">
                  <div className="text-xs text-gray-500 mb-1">{isBR ? 'PALPITES' : 'PICKS'}</div>
                  <div className="font-semibold group-hover:text-[var(--color-accent)] transition">{isBR ? 'Palpites do dia' : 'Picks do dia'}</div>
                  <div className="text-[11px] text-gray-500 mt-1">{isBR ? 'Edge ≥5% vs casas, grades A/B/C' : 'Edge ≥5% vs casas, grades A/B/C'}</div>
                </Link>
              </div>
            </div>
          </section>
        )}

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
                  : 'Classificação por força real — não por pontos ATP. Top 200 ATP + 200 WTA atualizado diariamente.'}
              </p>
            </Link>
            <Link href={lh('/ferramentas/predictor')} className="stat-card p-5 hover:border-[var(--color-accent)]/40 transition group">
              <div className="text-2xl mb-2">⚔️</div>
              <h3 className="font-semibold mb-1 group-hover:text-[var(--color-accent)] transition">ELO Predictor</h3>
              <p className="text-xs text-gray-500">
                {isBR
                  ? 'Probabilidade de vitória, score mais provável e Monte Carlo entre quaisquer 2 jogadores.'
                  : 'Probabilidade de vitória, score mais provável e Monte Carlo entre quaisquer 2 jogadores.'}
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
