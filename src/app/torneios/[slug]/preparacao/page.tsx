import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SurfaceFormGrid } from '@/components/SurfaceFormGrid';
import { hreflangAlternates, surfaceLabel, type Locale } from '@/lib/i18n';
import { displayElo } from '@/lib/elo';
import { AlertTriangleIcon } from '@/components/icons';

export const revalidate = 3600;

interface Tournament {
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
}

interface PlayerRow {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  photo_url: string | null;
  atp_rank: number | null;
  elo_set_overall: number | null;
  elo_set_hard: number | null;
  elo_set_clay: number | null;
  elo_set_grass: number | null;
  set_count: number | null;
}

async function fetchTournament(slug: string): Promise<Tournament | null> {
  const { data } = await supabase
    .from('tournaments')
    .select('slug,name,full_name,year,tour,category,surface,surface_label,location,flag,start_date,end_date')
    .eq('slug', slug)
    .single();
  return data;
}

async function fetchContenders(tour: string, limit = 40): Promise<PlayerRow[]> {
  const tours = tour === 'both' ? ['atp', 'wta'] : [tour];
  const out: PlayerRow[] = [];
  for (const t of tours) {
    const { data } = await supabase
      .from('players')
      .select('id,slug,name,flag,photo_url,atp_rank,elo_set_overall,elo_set_hard,elo_set_clay,elo_set_grass,set_count')
      .eq('tour', t)
      .eq('active', true)
      .gte('set_count', 100)
      .not('elo_set_overall', 'is', null)
      .order('elo_set_overall', { ascending: false, nullsFirst: false })
      .limit(limit);
    out.push(...(data ?? []) as PlayerRow[]);
  }
  return out;
}

export async function generateStaticParams() {
  // Major torneios futuros e recentes (slam + 1000)
  const { data } = await supabase
    .from('tournaments')
    .select('slug')
    .in('category', ['slam', '1000'])
    .gte('year', 2024)
    .limit(200);
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
  const surfStr = t.surface ? surfaceLabel('pt-PT', t.surface).toLowerCase() : 'superfície';
  return {
    title: `Quem está preparado para ${t.full_name ?? t.name}? · ELO ${surfStr}`,
    description: `Análise ELO pré-torneio para ${t.full_name ?? t.name} ${t.year}. Top contenders por ${surfStr}, specialists ocultos, jogadores vulneráveis. Modelo ELO próprio.`,
    alternates: hreflangAlternates(`/torneios/${slug}/preparacao`),
  };
}

interface PreparedPlayer extends PlayerRow {
  surfaceElo: number;
  residual: number;
  displayOverall: number;
  displaySurface: number;
}

function preparePlayers(rows: PlayerRow[], surface: 'hard'|'clay'|'grass'): PreparedPlayer[] {
  const field = `elo_set_${surface}` as const;
  return rows
    .filter(p => p[field] != null && p.elo_set_overall != null)
    .map(p => ({
      ...p,
      surfaceElo: p[field] as number,
      residual: (p[field] as number) - (p.elo_set_overall as number),
      displayOverall: Math.round(displayElo(p.elo_set_overall) ?? 0),
      displaySurface: Math.round(displayElo(p[field]) ?? 0),
    }));
}

function PlayerCard({ p, locale, prefix, showResidual = false }: {
  p: PreparedPlayer; locale: Locale; prefix: string; showResidual?: boolean;
}) {
  const initials = p.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const residualDisplay = p.displaySurface - p.displayOverall;
  return (
    <Link
      href={`${prefix}/jogador/${p.slug}`}
      className="flex items-center gap-3 p-3 stat-card hover:border-[var(--color-accent)]/50 transition"
    >
      <div className="relative w-10 h-10 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
        {p.photo_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={p.photo_url} alt={p.name} loading="lazy" className="w-full h-full object-cover" style={{ objectPosition: 'top center' }} />
        ) : (
          <span className="text-[10px] font-bold text-gray-500">{initials}</span>
        )}
        {p.flag && (
          <span className="absolute bottom-0 right-0 text-[9px] leading-none bg-[var(--color-surface)] rounded-tl px-0.5">{p.flag}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{p.name}</div>
        <div className="text-[10px] text-gray-500">
          ELO geral {p.displayOverall} · surface {p.displaySurface}
          {p.atp_rank && <> · #{p.atp_rank}</>}
        </div>
      </div>
      {showResidual && (
        <div className={`text-right whitespace-nowrap font-mono font-bold text-sm ${
          residualDisplay > 0 ? 'text-[var(--color-accent)]' : 'text-red-400'
        }`}>
          {residualDisplay > 0 ? '+' : ''}{residualDisplay}
        </div>
      )}
    </Link>
  );
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date);
  return Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default async function PreparacaoPage({
  params,
  locale = 'pt-PT',
}: {
  params: Promise<{ slug: string }>;
  locale?: Locale;
}) {
  const { slug } = await params;
  const t = await fetchTournament(slug);
  if (!t) notFound();

  const isBR = locale === 'pt-BR';
  const prefix = locale === 'pt-BR' ? '/br' : '';

  const surf = (t.surface ?? '').toLowerCase() as 'hard'|'clay'|'grass'|'indoor';
  const surfForRating = surf === 'indoor' ? 'hard' : surf;

  if (!['hard', 'clay', 'grass'].includes(surfForRating)) {
    notFound();
  }

  const tour = t.tour ?? 'atp';
  const contenders = await fetchContenders(tour, 40);
  const prepared = preparePlayers(contenders, surfForRating as 'hard'|'clay'|'grass');

  // Para o SurfaceFormGrid precisamos do top contenders por tour (slams = 'both')
  async function fetchContendersByTour(t: 'atp' | 'wta'): Promise<PlayerRow[]> {
    const { data } = await supabase
      .from('players')
      .select('id,slug,name,flag,photo_url,atp_rank,elo_set_overall,elo_set_hard,elo_set_clay,elo_set_grass,set_count')
      .eq('tour', t)
      .eq('active', true)
      .gte('set_count', 100)
      .not(`elo_set_${surfForRating}`, 'is', null)
      .order(`elo_set_${surfForRating}`, { ascending: false, nullsFirst: false })
      .limit(20);
    return (data ?? []) as PlayerRow[];
  }
  const atpTop = (tour === 'atp' || tour === 'both') ? await fetchContendersByTour('atp') : [];
  const wtaTop = (tour === 'wta' || tour === 'both') ? await fetchContendersByTour('wta') : [];

  // Top 20 by surface-ELO
  const topBySurface = [...prepared]
    .sort((a, b) => b.surfaceElo - a.surfaceElo)
    .slice(0, 20);

  // Hidden values: residual positivo significativo (>50 ELO display points)
  const hiddenValue = [...prepared]
    .filter(p => (p.displaySurface - p.displayOverall) >= 30)
    .sort((a, b) => (b.displaySurface - b.displayOverall) - (a.displaySurface - a.displayOverall))
    .slice(0, 10);

  // Vulneráveis: top 20 by overall mas com surface-ELO baixo (residual negativo)
  const top20Overall = [...prepared]
    .sort((a, b) => (b.elo_set_overall ?? 0) - (a.elo_set_overall ?? 0))
    .slice(0, 20);
  const vulnerable = top20Overall
    .filter(p => (p.displaySurface - p.displayOverall) <= -30)
    .sort((a, b) => (a.displaySurface - a.displayOverall) - (b.displaySurface - b.displayOverall))
    .slice(0, 8);

  const days = daysUntil(t.start_date);
  const isPast = t.end_date && new Date(t.end_date) < new Date();

  return (
    <>
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          {/* Breadcrumb */}
          <div className="text-xs text-gray-500 mb-4">
            <Link href={`${prefix}/`} className="hover:text-[var(--color-accent)]">Início</Link>
            <span className="mx-2">/</span>
            <Link href={`${prefix}/torneios`} className="hover:text-[var(--color-accent)]">Torneios</Link>
            <span className="mx-2">/</span>
            <Link href={`${prefix}/torneios/${t.slug}`} className="hover:text-[var(--color-accent)]">{t.name}</Link>
            <span className="mx-2">/</span>
            <span>Preparação</span>
          </div>

          {/* Hero */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              {t.surface_label && (
                <span className={`surface-pill surface-${surfForRating}`}>
                  {surf === 'indoor' ? 'Hard' : surfaceLabel(locale, surfForRating)}
                </span>
              )}
              {days != null && days >= 0 && days <= 60 && (
                <span className="text-xs uppercase tracking-wider text-blue-400 font-bold">
                  Começa em {days} dia{days === 1 ? '' : 's'}
                </span>
              )}
              {isPast && (
                <span className="text-xs uppercase tracking-wider text-gray-500 font-bold">
                  Edição passada
                </span>
              )}
            </div>
            <h1 className="text-2xl md:text-4xl font-extrabold mb-2">
              Quem está preparado para {t.full_name ?? t.name}?
            </h1>
            <p className="text-gray-400 text-sm md:text-base max-w-3xl">
              {isBR
                ? `Análise pré-torneio pelo modelo ELO. Top contenders por ${surfaceLabel(locale, surfForRating).toLowerCase()}, specialists ocultos, e jogadores vulneráveis nesta superfície.`
                : `Análise pré-torneio pelo modelo ELO. Top contenders por ${surfaceLabel(locale, surfForRating).toLowerCase()}, specialists ocultos, e jogadores vulneráveis nesta superfície.`}
            </p>
          </div>

          {/* Forma recente em surface — substitui o antigo scatter */}
          {atpTop.length > 0 && (
            <SurfaceFormGrid
              tour="atp"
              surface={surfForRating as 'hard' | 'clay' | 'grass'}
              players={atpTop}
              locale={locale}
              prefix={prefix}
            />
          )}
          {wtaTop.length > 0 && (
            <SurfaceFormGrid
              tour="wta"
              surface={surfForRating as 'hard' | 'clay' | 'grass'}
              players={wtaTop}
              locale={locale}
              prefix={prefix}
            />
          )}

          {/* Top 20 by surface */}
          <section className="mb-12">
            <h2 className="text-xl font-bold mb-2">
              Top 20 contenders por {surfaceLabel(locale, surfForRating).toLowerCase()}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Ordenados por ELO {surfaceLabel(locale, surfForRating).toLowerCase()} (não por ranking ATP/WTA)
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              {topBySurface.map((p, i) => (
                <div key={p.slug} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 font-mono w-6 text-right shrink-0">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <PlayerCard p={p} locale={locale} prefix={prefix} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Hidden value specialists */}
          {hiddenValue.length > 0 && (
            <section className="mb-12">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <span>💎</span>
                Hidden value — specialists
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Jogadores cujo ELO em {surfaceLabel(locale, surfForRating).toLowerCase()} é significativamente acima do seu ELO geral. Subvalorizados pelas casas.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                {hiddenValue.map(p => (
                  <PlayerCard key={p.slug} p={p} locale={locale} prefix={prefix} showResidual />
                ))}
              </div>
            </section>
          )}

          {/* Vulneráveis */}
          {vulnerable.length > 0 && (
            <section className="mb-12">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <AlertTriangleIcon size={20} className="text-yellow-400" />
                Vulneráveis nesta surface
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Top players cujo ELO em {surfaceLabel(locale, surfForRating).toLowerCase()} é significativamente abaixo do seu ELO geral. Possíveis surpresas no draw.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                {vulnerable.map(p => (
                  <PlayerCard key={p.slug} p={p} locale={locale} prefix={prefix} showResidual />
                ))}
              </div>
            </section>
          )}

          {/* CTA — back to tournament + specialists */}
          <div className="flex flex-wrap gap-3 mt-8">
            <Link
              href={`${prefix}/torneios/${t.slug}`}
              className="bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)] px-4 py-3 rounded-lg text-sm"
            >
              ← Página do torneio
            </Link>
            <Link
              href={`${prefix}/torneios/specialists`}
              className="bg-[var(--color-accent)] text-[var(--color-surface)] px-4 py-3 rounded-lg text-sm font-semibold"
            >
              💎 Ver todos os specialists
            </Link>
          </div>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
