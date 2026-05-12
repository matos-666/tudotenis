import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { breadcrumbJsonLd, sportsEventJsonLd } from '@/lib/jsonld';
import { EloSurfaceScatter } from '@/components/EloSurfaceScatter';
import { getLocale, hreflangAlternates } from '@/lib/i18n';

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

export async function generateStaticParams() {
  const { data } = await supabase.from('tournaments').select('slug');
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
  const desc = t.status === 'finished'
    ? `Resultado completo: ${winner ? `vencido por ${winner}` : 'detalhes oficiais'}. Final, finalistas, prize money, calendário.`
    : `${t.status === 'live' ? 'Em curso · ' : 'Próximo torneio · '}${t.story?.slice(0, 100) ?? ''}`;
  return {
    title: `${t.full_name ?? t.name} · ${t.surface_label ?? ''} · TudoTénis`,
    description: desc,
    alternates: hreflangAlternates(`/torneios/${t.slug}`),
    openGraph: {
      title: `${t.full_name ?? t.name}`,
      description: desc,
    },
  };
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
        <h3 className="font-bold">🏆 Final {tour}</h3>
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
            <div className="text-[9px] md:text-[10px] uppercase text-[var(--color-accent)] font-bold tracking-wider mb-0.5">
              🏆 Campeão
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
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await fetchTournament(slug);
  if (!t) notFound();

  const locale = await getLocale();
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

          {/* Scatter ELO Geral vs ELO Surface (insight diferenciador).
              Indoor é tratado como hard — não temos visualização própria
              porque há pouquíssima actividade no calendário indoor. */}
          {t.surface && (() => {
            const scatterSurface = t.surface === 'indoor' ? 'hard' : t.surface;
            return (
              <>
                {(t.tour === 'atp' || t.tour === 'both') && (
                  <EloSurfaceScatter tour="atp" surface={scatterSurface} locale={locale} />
                )}
                {(t.tour === 'wta' || t.tour === 'both') && (
                  <EloSurfaceScatter tour="wta" surface={scatterSurface} locale={locale} />
                )}
              </>
            );
          })()}

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
              className="bg-[var(--color-accent)] text-[var(--color-surface)] px-4 py-3 rounded-lg text-sm font-semibold"
            >
              🏆 Ver Ranking ELO
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
