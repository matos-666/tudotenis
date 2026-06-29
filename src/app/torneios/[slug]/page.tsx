import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { breadcrumbJsonLd, sportsEventJsonLd } from '@/lib/jsonld';
import { TournamentTopInsights } from '@/components/TournamentTopInsights';
import { hreflangAlternates, type Locale } from '@/lib/i18n';
import { TrophyIcon, TargetIcon, ChartIcon } from '@/components/icons';

export const revalidate = 3600;

interface Player {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  photo_url: string | null;
}

interface Tournament {
  id: number;
  slug: string;
  name: string;
  full_name: string | null;
  year: number;
  tour: string;
  category: string | null;
  surface: string | null;
  surface_label: string | null;
  location: string | null;
  flag: string | null;
  start_date: string | null;
  end_date: string | null;
  prize_money: string | null;
  draw_size: string | null;
  status: string | null;
  story: string | null;
  atp_score: string | null;
  wta_score: string | null;
  atp_winner: Player | null;
  atp_finalist: Player | null;
  wta_winner: Player | null;
  wta_finalist: Player | null;
}

async function fetchTournament(slug: string): Promise<Tournament | null> {
  const { data } = await supabase
    .from('tournaments')
    .select(`
      *,
      atp_winner:players!tournaments_atp_winner_id_fkey(id, slug, name, flag, photo_url),
      atp_finalist:players!tournaments_atp_finalist_id_fkey(id, slug, name, flag, photo_url),
      wta_winner:players!tournaments_wta_winner_id_fkey(id, slug, name, flag, photo_url),
      wta_finalist:players!tournaments_wta_finalist_id_fkey(id, slug, name, flag, photo_url)
    `)
    .eq('slug', slug)
    .single();
  return data as Tournament | null;
}

// SSG apenas torneios slam + Masters 1000/WTA 1000 dos últimos 3 anos
// + torneios futuros próximos. Resto via ISR.
export const dynamicParams = true;

export async function generateStaticParams() {
  const minYear = new Date().getUTCFullYear() - 2;
  const { data } = await supabase
    .from('tournaments')
    .select('slug')
    .in('category', ['slam', '1000'])
    .gte('year', minYear);
  return (data ?? []).map(t => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await fetchTournament(slug);
  if (!t) return { title: 'Torneio não encontrado' };
  const winner = t.atp_winner?.name || t.wta_winner?.name;
  const fullName = t.full_name ?? t.name;
  const surf = t.surface_label ?? '';
  const loc = t.location ? ` em ${t.location}` : '';
  const dates = formatDateRangePT(t.start_date, t.end_date);
  const desc = t.status === 'finished'
    ? `${fullName}${loc} · ${surf} · ${winner ? `vencido por ${winner}` : 'resultado oficial'}. Final, finalistas, draw, prize money.`
    : t.status === 'live'
    ? `${fullName} em curso${loc} · ${surf}${dates ? ` · ${dates}` : ''}. Predictor, draw ao vivo, palpites por ronda e probabilidades pelo modelo ELO TudoTénis.`
    : `Predictor e análise ELO para ${fullName}${loc} · ${surf}${dates ? ` · ${dates}` : ''}. Top favoritos, probabilidades, palpites e estatísticas avançadas.`;
  return {
    title: `${fullName} · ${surf}`,
    description: desc,
    alternates: hreflangAlternates(`/torneios/${t.slug}`),
    openGraph: {
      title: fullName,
      description: desc,
    },
  };
}

function formatDateRangePT(start: string | null, end: string | null): string {
  if (!start) return '';
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const mNames = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const sm = mNames[s.getUTCMonth()];
  if (!e) return `${s.getUTCDate()} ${sm}`;
  const em = mNames[e.getUTCMonth()];
  if (sm === em && s.getUTCFullYear() === e.getUTCFullYear()) {
    return `${s.getUTCDate()}-${e.getUTCDate()} ${sm}`;
  }
  return `${s.getUTCDate()} ${sm}-${e.getUTCDate()} ${em}`;
}

// Indoor não tem styling próprio na UI — torneios indoor são quase sempre
// hard courts cobertos, por isso caem para a pill 'hard'.
const SURFACE_CLASS = {
  clay: 'surface-clay',
  hard: 'surface-hard',
  grass: 'surface-grass',
  indoor: 'surface-hard',
} as const;

const CAT_LABEL = {
  slam: 'Grand Slam',
  '1000': 'ATP/WTA Masters 1000',
  '500': 'ATP/WTA 500',
  '250': 'ATP 250',
  challenger: 'Challenger',
} as const;

function FinalCard({
  tour,
  winner,
  finalist,
  score,
  prefix = '',
}: {
  tour: 'ATP' | 'WTA';
  winner: Player | null;
  finalist: Player | null;
  score: string | null;
  prefix?: string;
}) {
  if (!winner) return null;
  const wInitials = winner.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const fInitials = finalist?.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? '';
  return (
    <div className="stat-card p-5 md:p-6 mb-4">
      <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
        <h3 className="font-bold inline-flex items-center gap-2"><TrophyIcon size={18} className="text-[var(--color-accent)]" /> Final {tour}</h3>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 md:gap-6">
        {/* Winner */}
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <Link
            href={`${prefix}/jogador/${winner.slug}`}
            className="w-12 h-12 md:w-20 md:h-20 rounded-xl bg-gradient-to-br from-[var(--color-accent)]/30 to-[var(--color-accent)]/5 border-2 border-[var(--color-accent)] flex items-center justify-center text-sm md:text-2xl font-extrabold overflow-hidden flex-shrink-0"
          >
            {winner.photo_url ? (
              <Image src={winner.photo_url} alt={winner.name} width={120} height={120} className="w-full h-full object-cover object-top" unoptimized />
            ) : (
              <span>{wInitials}</span>
            )}
          </Link>
          <div className="min-w-0">
            <div className="text-[9px] md:text-[10px] uppercase text-[var(--color-accent)] font-bold tracking-wider mb-0.5 inline-flex items-center gap-1">
              <TrophyIcon size={11} /> Campeão
            </div>
            <Link href={`${prefix}/jogador/${winner.slug}`} className="font-bold truncate text-sm md:text-lg block hover:underline">
              {winner.name}
            </Link>
            <div className="text-[10px] md:text-xs text-gray-500">{winner.flag}</div>
          </div>
        </div>
        {/* Score */}
        <div className="text-center min-w-0">
          <div className="text-[9px] md:text-xs uppercase tracking-wider text-gray-500 mb-1">
            Resultado
          </div>
          <div className="text-xs md:text-xl font-extrabold font-mono leading-tight">
            {score ?? '—'}
          </div>
        </div>
        {/* Finalist */}
        {finalist ? (
          <div className="flex items-center gap-2 md:gap-3 justify-end min-w-0">
            <div className="text-right min-w-0">
              <div className="text-[9px] md:text-[10px] uppercase text-gray-500 font-bold tracking-wider mb-0.5">
                Finalista
              </div>
              <Link href={`${prefix}/jogador/${finalist.slug}`} className="font-semibold truncate text-sm md:text-base block hover:underline">
                {finalist.name}
              </Link>
              <div className="text-[10px] md:text-xs text-gray-500">{finalist.flag}</div>
            </div>
            <Link
              href={`${prefix}/jogador/${finalist.slug}`}
              className="w-10 h-10 md:w-16 md:h-16 rounded-xl bg-[var(--color-card)] border border-[var(--color-border)] flex items-center justify-center text-xs md:text-xl font-bold overflow-hidden flex-shrink-0"
            >
              {finalist.photo_url ? (
                <Image src={finalist.photo_url} alt={finalist.name} width={120} height={120} className="w-full h-full object-cover object-top" unoptimized />
              ) : (
                <span>{fInitials}</span>
              )}
            </Link>
          </div>
        ) : (
          <div className="text-right text-xs text-gray-500">—</div>
        )}
      </div>
    </div>
  );
}

export default async function TournamentDetail({
  params,
  locale = 'pt-PT',
}: {
  params: Promise<{ slug: string }>;
  locale?: Locale;
}) {
  const { slug } = await params;
  const t = await fetchTournament(slug);
  if (!t) notFound();

  const prefix = locale === 'pt-BR' ? '/br' : '';

  const surfClass = t.surface ? SURFACE_CLASS[t.surface as keyof typeof SURFACE_CLASS] : '';
  const catLabel = t.category ? CAT_LABEL[t.category as keyof typeof CAT_LABEL] : '';
  const isLive = t.status === 'live';
  const isUpcoming = t.status === 'scheduled';

  // JSON-LD: SportsEvent + BreadcrumbList
  const sportsEvent = sportsEventJsonLd({
    name: t.full_name ?? t.name,
    url: `https://tudotenis.com/torneios/${t.slug}`,
    startDate: t.start_date,
    endDate: t.end_date,
    location: t.location,
    surface: t.surface_label,
    status: t.status,
  });

  const breadcrumb = breadcrumbJsonLd([
    { name: 'Início',    href: `${prefix}/` },
    { name: 'Torneios',  href: `${prefix}/torneios` },
    { name: t.full_name ?? t.name, href: `${prefix}/torneios/${t.slug}` },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(sportsEvent) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          {/* Breadcrumb */}
          <div className="text-xs text-gray-500 mb-4">
            <Link href={`${prefix}/`} className="hover:text-[var(--color-accent)]">Início</Link>
            <span className="mx-2">/</span>
            <Link href={`${prefix}/torneios`} className="hover:text-[var(--color-accent)]">Torneios</Link>
            <span className="mx-2">/</span>
            <span>{t.full_name ?? t.name}</span>
          </div>

          {/* Header */}
          <div className="flex items-start gap-4 md:gap-6 mb-5 md:mb-8">
            <div className="w-14 h-14 md:w-20 md:h-20 rounded-2xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-2xl md:text-4xl flex-shrink-0">
              {t.flag}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl md:text-4xl font-extrabold mb-1 leading-tight">
                {t.full_name ?? t.name}
              </h1>
              <p className="text-gray-400 text-xs md:text-sm">{t.location}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {t.surface_label && (
                  <span className={`surface-pill ${surfClass}`}>
                    {t.surface === 'indoor' ? 'Hard' : t.surface_label}
                  </span>
                )}
                <span className="text-xs text-gray-500">{catLabel}</span>
                {isLive && (
                  <span className="text-[10px] uppercase font-bold tracking-wider text-red-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                    EM CURSO
                  </span>
                )}
                {isUpcoming && (
                  <span className="text-[10px] uppercase font-bold tracking-wider text-blue-400">
                    PRÓXIMO
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick info row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-6">
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
              <div className="text-[10px] uppercase text-gray-500 mb-1">Datas</div>
              <div className="text-sm font-semibold">
                {t.start_date && t.end_date
                  ? `${t.start_date} → ${t.end_date}`
                  : '—'}
              </div>
            </div>
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
              <div className="text-[10px] uppercase text-gray-500 mb-1">Premiação</div>
              <div className="text-sm font-semibold font-mono">{t.prize_money ?? '—'}</div>
            </div>
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
              <div className="text-[10px] uppercase text-gray-500 mb-1">Quadro</div>
              <div className="text-sm font-semibold font-mono">{t.draw_size ?? '—'}</div>
            </div>
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
              <div className="text-[10px] uppercase text-gray-500 mb-1">Categoria</div>
              <div className="text-sm font-semibold">{catLabel}</div>
            </div>
          </div>

          {/* Insights de pré-torneio — só para edições futuras ou em curso,
              porque os ratings reflectem o agora, não o momento do torneio. */}
          {t.surface && (isLive || isUpcoming) && (
            <>
              {(t.tour === 'atp' || t.tour === 'both') && (
                <TournamentTopInsights
                  tour="atp"
                  surface={t.surface}
                  locale={locale}
                  prefix={prefix}
                />
              )}
              {(t.tour === 'wta' || t.tour === 'both') && (
                <TournamentTopInsights
                  tour="wta"
                  surface={t.surface}
                  locale={locale}
                  prefix={prefix}
                />
              )}
            </>
          )}

          {/* Story */}
          {t.story && (
            <div className="stat-card p-5 md:p-6 mb-6 border-[var(--color-accent)]/20">
              <h2 className="text-xs font-bold text-[var(--color-accent)] mb-2 uppercase tracking-wider">
                Resumo do torneio
              </h2>
              <p className="text-gray-300 text-sm md:text-base leading-relaxed">{t.story}</p>
            </div>
          )}

          {/* Finals */}
          <FinalCard
            tour="ATP"
            winner={t.atp_winner}
            finalist={t.atp_finalist}
            score={t.atp_score}
            prefix={prefix}
          />
          <FinalCard
            tour="WTA"
            winner={t.wta_winner}
            finalist={t.wta_finalist}
            score={t.wta_score}
            prefix={prefix}
          />

          {/* CTA insights — só para slams + 1000 em superfícies suportadas */}
          {t.surface && ['hard', 'clay', 'grass', 'indoor'].includes(t.surface) &&
           (t.category === 'slam' || t.category === '1000') && (
            <div className="grid sm:grid-cols-2 gap-3 mt-8 mb-6">
              <Link
                href={`${prefix}/torneios/${t.slug}/preparacao`}
                className="stat-card p-4 hover:border-[var(--color-accent)]/40 transition group"
              >
                <TargetIcon size={26} className="mb-2 text-[var(--color-accent)]" />
                <h3 className="font-bold mb-1 group-hover:text-[var(--color-accent)] transition">
                  Quem está preparado?
                </h3>
                <p className="text-xs text-gray-500">
                  Top contenders por surface · specialists ocultos · vulneráveis
                </p>
              </Link>
              <Link
                href={`${prefix}/torneios/${t.slug}/predictor`}
                className="stat-card p-4 hover:border-[var(--color-accent)]/40 transition group"
              >
                <ChartIcon size={26} className="mb-2 text-[var(--color-accent)]" />
                <h3 className="font-bold mb-1 group-hover:text-[var(--color-accent)] transition">
                  Predictor Monte Carlo
                </h3>
                <p className="text-xs text-gray-500">
                  Probabilidade de cada player vencer · 5000 simulações
                </p>
              </Link>
            </div>
          )}

          {/* CTA */}
          <div className="flex flex-wrap gap-3 mt-8">
            <Link
              href={`${prefix}/torneios`}
              className="bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)] px-4 py-3 rounded-lg text-sm"
            >
              ← Voltar ao calendário
            </Link>
            <Link
              href={`${prefix}/ranking`}
              className="bg-[var(--color-accent)] text-[var(--color-surface)] px-4 py-3 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
            >
              <TrophyIcon size={16} /> Ver Ranking ELO
            </Link>
          </div>

          {/* Disclaimer */}
          <div className="text-[10px] text-gray-600 mt-6 pt-4 border-t border-[var(--color-border)]">
            Dados oficiais sincronizados automaticamente · fonte: ATP/WTA Tour
          </div>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
