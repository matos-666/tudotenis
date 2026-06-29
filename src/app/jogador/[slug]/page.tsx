import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { EloChart } from '@/components/EloChart';
import { breadcrumbJsonLd } from '@/lib/jsonld';
import { hreflangAlternates, surfaceLabel, type Locale } from '@/lib/i18n';
import { displayElo } from '@/lib/elo';

// Re-gerar a cada hora; novos jogadores acrescentados via cron
export const revalidate = 3600;

interface Player {
  id: number;
  slug: string;
  name: string;
  country: string | null;
  flag: string | null;
  birth_date: string | null;
  height_cm: number | null;
  hand: string | null;
  tour: string;
  atp_rank: number | null;
  photo_url: string | null;
  elo_overall: number | null;
  elo_hard: number | null;
  elo_clay: number | null;
  elo_grass: number | null;
  elo_indoor: number | null;
  elo_set_overall: number | null;
  elo_set_hard: number | null;
  elo_set_clay: number | null;
  elo_set_grass: number | null;
  elo_30d_ago: number | null;
  form_l5: string | null;
  titles: number;
  slams: number;
}

async function fetchPlayer(slug: string): Promise<Player | null> {
  // Apenas colunas usadas no perfil (omite career_high, doubles_*, set_count,
  // created_at, updated_at, active — egress ~50% menor).
  const { data } = await supabase
    .from('players')
    .select('id, slug, name, country, flag, birth_date, height_cm, hand, tour, atp_rank, photo_url, elo_overall, elo_hard, elo_clay, elo_grass, elo_indoor, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass, elo_30d_ago, form_l5, titles, slams')
    .eq('slug', slug)
    .single();
  return data;
}

// SSG: gera estaticamente perfis de todos os players activos
export async function generateStaticParams() {
  const { data } = await supabase
    .from('players')
    .select('slug')
    .eq('active', true);
  return (data ?? []).map(p => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = await fetchPlayer(slug);
  if (!p) return { title: 'Jogador não encontrado' };
  return {
    title: `${p.name} · ELO ${p.elo_overall} · Stats e Perfil`,
    description: `Perfil de ${p.name} (${p.tour.toUpperCase()} #${p.atp_rank ?? '?'}). ELO próprio: ${p.elo_overall} geral · ${p.elo_hard} hard · ${p.elo_clay} terra batida · ${p.elo_grass} relvado. Histórico, splits por superfície, próximos jogos.`,
    alternates: hreflangAlternates(`/jogador/${p.slug}`),
    openGraph: {
      title: `${p.name}`,
      description: `ELO ${p.elo_overall} · ${p.tour.toUpperCase()} #${p.atp_rank ?? '?'}`,
      images: p.photo_url ? [{ url: p.photo_url, alt: p.name }] : undefined,
    },
  };
}

function calcAge(birth: string | null): number | null {
  if (!birth) return null;
  const today = new Date();
  const b = new Date(birth);
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}

export default async function PlayerPage({
  params,
  locale = 'pt-PT',
}: {
  params: Promise<{ slug: string }>;
  locale?: Locale;
}) {
  const { slug } = await params;
  const player = await fetchPlayer(slug);
  if (!player) notFound();

  const prefix = locale === 'pt-BR' ? '/br' : '';

  const delta = player.elo_overall && player.elo_30d_ago
    ? player.elo_overall - player.elo_30d_ago
    : null;

  const initials = player.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const age = calcAge(player.birth_date);

  // JSON-LD Person
  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: player.name,
    nationality: player.country,
    height: player.height_cm ? `${player.height_cm} cm` : undefined,
    image: player.photo_url,
    jobTitle: `Tenista profissional ${player.tour.toUpperCase()}`,
    url: `https://tudotenis.com/jogador/${player.slug}`,
  };

  const breadcrumb = breadcrumbJsonLd([
    { name: 'Início',     href: `${prefix}/` },
    { name: 'Jogadores',  href: `${prefix}/jogadores` },
    { name: player.name,  href: `${prefix}/jogador/${player.slug}` },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          {/* Breadcrumb */}
          <div className="text-xs text-gray-500 mb-4">
            <Link href={`${prefix}/`} className="hover:text-[var(--color-accent)]">
              Início
            </Link>
            <span className="mx-2">/</span>
            <Link href={`${prefix}/jogadores`} className="hover:text-[var(--color-accent)]">
              Jogadores
            </Link>
            <span className="mx-2">/</span>
            <span>{player.name}</span>
          </div>

          {/* Player header */}
          <div className="flex items-start gap-4 md:gap-6 mb-6 md:mb-8 flex-col sm:flex-row">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-gradient-to-br from-[var(--color-accent)]/30 to-[var(--color-accent)]/5 border border-[var(--color-accent)]/20 flex items-center justify-center text-3xl md:text-4xl font-extrabold overflow-hidden flex-shrink-0">
              {player.photo_url ? (
                <Image
                  src={player.photo_url}
                  alt={player.name}
                  width={120}
                  height={120}
                  className="w-full h-full object-cover object-top"
                />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 md:gap-3 mb-2 flex-wrap">
                <h1 className="text-3xl md:text-4xl font-extrabold">{player.name}</h1>
                <span className="text-xl md:text-2xl">{player.flag}</span>
              </div>
              <div className="text-gray-400 text-xs md:text-sm flex gap-2 md:gap-4 flex-wrap">
                {age && <span>{age} anos</span>}
                {player.height_cm && <span>· {player.height_cm}cm</span>}
                {player.hand && (
                  <span>· {player.hand === 'right' ? 'Destro' : 'Canhoto'}</span>
                )}
                <span>· {player.tour.toUpperCase()} #{player.atp_rank ?? '—'}</span>
                {player.titles > 0 && <span>· {player.titles} títulos</span>}
                {player.slams > 0 && <span>· {player.slams} Slams</span>}
              </div>
            </div>
            <div className="text-left sm:text-right flex-shrink-0">
              <div className="text-xs text-gray-500 mb-1">ELO Geral</div>
              <div className="text-3xl md:text-4xl font-extrabold text-[var(--color-accent)] font-mono">
                {Math.round(displayElo(player.elo_set_overall) ?? player.elo_overall ?? 0) || '—'}
              </div>
              {delta != null && (
                <div className={`text-xs ${delta >= 0 ? 'win' : 'loss'}`}>
                  {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)} nos últimos 30 dias
                </div>
              )}
            </div>
          </div>

          {/* ELO por superfície (Indoor omitido — pouca actividade no tour) */}
          <div className="grid grid-cols-3 gap-2 md:gap-4 mb-8">
            {[
              { label: `Hard`,                            value: Math.round(displayElo(player.elo_set_hard)  ?? player.elo_hard  ?? 0) || null, badge: 'Hard',                          cls: 'surface-hard' },
              { label: surfaceLabel(locale, 'clay'),      value: Math.round(displayElo(player.elo_set_clay)  ?? player.elo_clay  ?? 0) || null, badge: surfaceLabel(locale, 'clay'),    cls: 'surface-clay' },
              { label: surfaceLabel(locale, 'grass'),     value: Math.round(displayElo(player.elo_set_grass) ?? player.elo_grass ?? 0) || null, badge: surfaceLabel(locale, 'grass'),   cls: 'surface-grass' },
            ].map(s => (
              <div key={s.label} className="stat-card p-3 md:p-5">
                <div className="flex items-center justify-between mb-2 gap-1">
                  <span className="text-[10px] md:text-xs uppercase text-gray-500 truncate">ELO</span>
                  <span className={`surface-pill ${s.cls} text-[9px] md:text-xs whitespace-nowrap`}>{s.badge}</span>
                </div>
                <div className="text-xl md:text-3xl font-extrabold font-mono">
                  {s.value ?? '—'}
                </div>
              </div>
            ))}
          </div>

          {/* Forma recente */}
          {player.form_l5 && (
            <div className="stat-card p-5 md:p-6 mb-8">
              <h3 className="font-bold mb-4">Forma · últimos 5 jogos</h3>
              <div className="flex gap-2">
                {player.form_l5.split('').map((r, i) => (
                  <div
                    key={i}
                    className={`w-12 h-12 rounded-lg flex items-center justify-center font-mono font-bold text-lg ${
                      r === 'V'
                        ? 'bg-[var(--color-win)]/15 win border border-[var(--color-win)]/30'
                        : 'bg-[var(--color-loss)]/15 loss border border-[var(--color-loss)]/30'
                    }`}
                  >
                    {r}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ELO chart (24 meses, 5 superfícies) */}
          <EloChart playerId={player.id} locale={locale} />

          {/* Quick links */}
          <div className="grid sm:grid-cols-3 gap-3">
            <Link
              href={`${prefix}/h2h/${player.slug}`}
              className="stat-card p-4 hover:border-[var(--color-accent)]/50"
            >
              <div className="text-2xl mb-2">⚔️</div>
              <div className="font-semibold">H2H</div>
              <div className="text-xs text-gray-500">
                {locale === 'pt-BR' ? 'Compare com qualquer jogador' : 'Compara com qualquer jogador'}
              </div>
            </Link>
            <Link
              href={`${prefix}/ferramentas/predictor`}
              className="stat-card p-4 hover:border-[var(--color-accent)]/50"
            >
              <div className="text-2xl mb-2">🎯</div>
              <div className="font-semibold">ELO Predictor</div>
              <div className="text-xs text-gray-500">
                Probabilidade vs outro jogador
              </div>
            </Link>
            <Link
              href={`${prefix}/ranking`}
              className="stat-card p-4 hover:border-[var(--color-accent)]/50"
            >
              <div className="text-2xl mb-2">🏆</div>
              <div className="font-semibold">Ranking ELO</div>
              <div className="text-xs text-gray-500">
                Onde {player.name.split(' ').pop()} está
              </div>
            </Link>
          </div>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
