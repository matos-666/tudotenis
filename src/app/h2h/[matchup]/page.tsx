import { notFound, redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { eloProb, fairOdds, parseMatchupSlug, displayElo } from '@/lib/elo';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { breadcrumbJsonLd } from '@/lib/jsonld';
import { H2HSparklineCompare } from '@/components/H2HSparklineCompare';
import { H2HSurfaceMiniSparkline } from '@/components/H2HSurfaceMiniSparkline';
import { fetchH2HSurfaceHistory } from '@/lib/h2h-surface-history';
import { getLocale, hreflangAlternates, surfaceLabel } from '@/lib/i18n';

export const revalidate = 3600;

interface Player {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
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

/** Preferir set-level ELO com fallback para match-level. */
function eloFor(p: Player, surface: 'overall' | 'hard' | 'clay' | 'grass'): number {
  if (surface === 'overall') {
    return p.elo_set_overall ?? p.elo_overall ?? 1500;
  }
  const setKey = `elo_set_${surface}` as const;
  const matchKey = `elo_${surface}` as const;
  return p[setKey] ?? p.elo_set_overall ?? p[matchKey] ?? p.elo_overall ?? 1500;
}

/**
 * Fetch leve de TODOS os slugs (incluindo inactivos). Necessário para
 * parseMatchupSlug saber onde dividir o slug composto. Range header
 * permite ir além do limite default de 1000.
 */
// fetchAllSlugs corre potencialmente em cada render de H2H. Cache server-side
// 12h via unstable_cache para evitar puxar 1182 slugs em todas as paginações.
//
// IMPORTANTE: unstable_cache serializa o resultado em JSON. Sets NÃO são
// serializáveis (deserializam como {} sem método .has). Logo, a inner
// function devolve string[] e convertemos para Set após.
const fetchAllSlugsArr = unstable_cache(
  async (): Promise<string[]> => {
    const slugs: string[] = [];
    let offset = 0;
    const page = 1000;
    for (let i = 0; i < 5; i++) {
      const { data } = await supabase
        .from('players')
        .select('slug')
        .range(offset, offset + page - 1);
      if (!data || data.length === 0) break;
      for (const p of data) slugs.push(p.slug);
      if (data.length < page) break;
      offset += page;
    }
    return slugs;
  },
  ['h2h-all-player-slugs-v2'],
  { revalidate: 43200, tags: ['players-slugs'] }, // 12h
);

async function fetchAllSlugs(): Promise<Set<string>> {
  return new Set(await fetchAllSlugsArr());
}

async function fetchPair(
  matchup: string
): Promise<{ p1: Player; p2: Player } | null> {
  const knownSlugs = await fetchAllSlugs();
  const parsed = parseMatchupSlug(matchup, knownSlugs);
  if (!parsed) return null;
  const [slugA, slugB] = parsed;
  if (slugA === slugB) return null;

  // Fetch só os 2 players necessários (mais rápido que carregar todos)
  // Apenas as colunas usadas no interface Player (egress -50%).
  const { data } = await supabase
    .from('players')
    .select('id, slug, name, flag, tour, atp_rank, photo_url, elo_overall, elo_hard, elo_clay, elo_grass, elo_indoor, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass, elo_30d_ago, form_l5, titles, slams')
    .in('slug', [slugA, slugB]);
  if (!data || data.length < 2) return null;
  const p1 = data.find(p => p.slug === slugA) as Player | undefined;
  const p2 = data.find(p => p.slug === slugB) as Player | undefined;
  if (!p1 || !p2) return null;

  // Ordenar por set-level ELO (preferred) com fallback para match-level
  const e1 = p1.elo_set_overall ?? p1.elo_overall ?? 0;
  const e2 = p2.elo_set_overall ?? p2.elo_overall ?? 0;
  if (e2 > e1) {
    return { p1: p2, p2: p1 };
  }
  return { p1, p2 };
}

// ═══════════════════════════════════════════════════════════
// SSG: pre-render H2H apenas para top 50 ATP + top 50 WTA
// → C(100, 2) = 4.950 pages no build
// Outros matchups gerados on-demand (ISR fallback) e cached.
// ═══════════════════════════════════════════════════════════
export const dynamicParams = true;

export async function generateStaticParams() {
  // Top 50 ATP + Top 50 WTA por set-level ELO
  const { data: atp } = await supabase
    .from('players')
    .select('slug, tour')
    .eq('tour', 'atp')
    .eq('active', true)
    .order('elo_set_overall', { ascending: false, nullsFirst: false })
    .limit(50);
  const { data: wta } = await supabase
    .from('players')
    .select('slug, tour')
    .eq('tour', 'wta')
    .eq('active', true)
    .order('elo_set_overall', { ascending: false, nullsFirst: false })
    .limit(50);
  const top = [...(atp ?? []), ...(wta ?? [])];
  const params: { matchup: string }[] = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const slugs = [top[i].slug, top[j].slug].sort();
      params.push({ matchup: `${slugs[0]}-vs-${slugs[1]}` });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchup: string }>;
}): Promise<Metadata> {
  const { matchup } = await params;
  const pair = await fetchPair(matchup);
  if (!pair) return { title: 'H2H não encontrado' };
  const { p1, p2 } = pair;
  const e1 = eloFor(p1, 'overall');
  const e2 = eloFor(p2, 'overall');
  // set-level ELO → eloProb dá set-prob → BO3 match prob
  const setProb = eloProb(e1, e2);
  const probP1 = Math.round((setProb*setProb*(3 - 2*setProb)) * 100);
  return {
    title: `${p1.name} vs ${p2.name} · H2H · Probabilidade ${probP1}/${100 - probP1}`,
    description: `Confronto direto entre ${p1.name} (ELO ${e1}) e ${p2.name} (ELO ${e2}). Probabilidades por superfície (terra batida, hard, relvado), comparação de forma, quotas justas. Análise pelo modelo ELO TudoTénis.`,
    alternates: hreflangAlternates(`/h2h/${matchup}`),
    openGraph: {
      title: `${p1.name} vs ${p2.name} · H2H`,
      description: `${probP1}% / ${100 - probP1}% · ${p1.tour.toUpperCase()}`,
    },
  };
}

// Labels resolvidos em runtime via surfaceLabel(locale, ...).
// Indoor é omitido — pouquíssimos jogos no calendário, ratings tipicamente
// no default 1500 e probabilidades 50/50 acabam por confundir mais que
// ajudar. Hard, terra batida e relvado cobrem >95% do tour.
const SURFACES = [
  { key: 'hard',   field: 'elo_hard',   cls: 'surface-hard'   },
  { key: 'clay',   field: 'elo_clay',   cls: 'surface-clay'   },
  { key: 'grass',  field: 'elo_grass',  cls: 'surface-grass'  },
] as const;

function PlayerHeadCard({ p, isFav, prefix = '' }: { p: Player; isFav: boolean; prefix?: string }) {
  const initials = p.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="text-center">
      <div className={`w-20 h-20 md:w-28 md:h-28 mx-auto rounded-2xl flex items-center justify-center text-2xl md:text-4xl font-extrabold overflow-hidden mb-3 ${
        isFav
          ? 'bg-gradient-to-br from-[var(--color-accent)]/30 to-[var(--color-accent)]/5 border-2 border-[var(--color-accent)]'
          : 'bg-gradient-to-br from-orange-500/20 to-orange-500/5 border border-orange-500/30'
      }`}>
        {p.photo_url ? (
          <Image
            src={p.photo_url}
            alt={p.name}
            width={120}
            height={120}
            className="w-full h-full object-cover object-top"
            unoptimized
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>
      <Link
        href={`${prefix}/jogador/${p.slug}`}
        className="font-bold text-base md:text-lg block hover:text-[var(--color-accent)] transition"
      >
        {p.name}
      </Link>
      <div className="text-xs text-gray-500 mb-2">
        {p.flag} {p.tour.toUpperCase()} #{p.atp_rank ?? '—'}
      </div>
      <div className="font-mono text-xl md:text-2xl font-extrabold">
        {Math.round(displayElo(p.elo_set_overall) ?? p.elo_overall ?? 0) || '—'}
      </div>
      <div className="text-[10px] text-gray-600 uppercase tracking-wider">ELO geral</div>
    </div>
  );
}

export default async function H2HPage({
  params,
}: {
  params: Promise<{ matchup: string }>;
}) {
  const { matchup } = await params;
  const locale = await getLocale();
  const prefix = locale === 'pt-BR' ? '/br' : '';

  // Single-player slug (sem "-vs-" e player existe) → redirect para perfil
  if (!matchup.includes('-vs-') && !matchup.includes('-')) {
    redirect(`${prefix}/jogador/${matchup}`);
  }

  const pair = await fetchPair(matchup);

  // Se não conseguiu parsear como par mas é um slug válido de player → redirect
  if (!pair) {
    const { data } = await supabase
      .from('players')
      .select('slug')
      .eq('slug', matchup)
      .maybeSingle();
    if (data) redirect(`${prefix}/jogador/${matchup}`);
    notFound();
  }

  const { p1, p2 } = pair;

  // Set-level ELO → eloProb dá set-prob → compor com BO formula para
  // probabilidade de match. Default BO3 (formato standard ATP/WTA).
  const eloOverall1 = eloFor(p1, 'overall');
  const eloOverall2 = eloFor(p2, 'overall');
  const setProbOverall = eloProb(eloOverall1, eloOverall2);
  const overallProb1 = setProbOverall * setProbOverall * (3 - 2 * setProbOverall);
  const overallProb2 = 1 - overallProb1;
  const overallFav = overallProb1 >= 0.5 ? p1 : p2;

  // Per-surface (também BO3)
  const surfaceData = SURFACES.map(s => {
    const surfKey = s.key as 'hard' | 'clay' | 'grass';
    const e1 = eloFor(p1, surfKey);
    const e2 = eloFor(p2, surfKey);
    const setP = eloProb(e1, e2);
    const prob1 = setP * setP * (3 - 2 * setP);
    return {
      ...s,
      e1, e2,
      prob1,
      prob2: 1 - prob1,
      fairP1: fairOdds(prob1),
      fairP2: fairOdds(1 - prob1),
      favIsP1: prob1 >= 0.5,
    };
  });

  // Fetch surface history (1 query devolve hard/clay/grass para os 2 players)
  const surfaceHistory = await fetchH2HSurfaceHistory(p1.id, p2.id);

  // Generate insight
  const surfaceFavP1 = surfaceData.filter(s => s.favIsP1).length;
  const surfaceFavP2 = surfaceData.length - surfaceFavP1;
  let insight: string;
  if (surfaceFavP1 === 4) {
    insight = `${p1.name} é favorito em todas as superfícies — domínio claro no confronto.`;
  } else if (surfaceFavP2 === 4) {
    insight = `${p2.name} é favorito em todas as superfícies — surpresa do modelo dada a vantagem ELO geral.`;
  } else {
    const pBest = [...surfaceData].sort((a, b) => b.prob1 - a.prob1)[0];
    const pWorst = [...surfaceData].sort((a, b) => a.prob1 - b.prob1)[0];
    insight = `${p1.name.split(' ').pop()} é mais forte em ${surfaceLabel(locale, pBest.key).toLowerCase()} (${Math.round(pBest.prob1 * 100)}%), mas em ${surfaceLabel(locale, pWorst.key).toLowerCase()} ${p2.name.split(' ').pop()} ganha vantagem (${Math.round(pWorst.prob2 * 100)}%).`;
  }

  // JSON-LD: SportsEvent (potencial)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${p1.name} vs ${p2.name}`,
    sport: 'Tennis',
    competitor: [
      { '@type': 'Person', name: p1.name, nationality: p1.flag },
      { '@type': 'Person', name: p2.name, nationality: p2.flag },
    ],
  };

  const breadcrumb = breadcrumbJsonLd([
    { name: 'Início',  href: `${prefix}/` },
    { name: 'H2H',     href: `${prefix}/h2h` },
    { name: `${p1.name} vs ${p2.name}`, href: `${prefix}/h2h/${matchup}` },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <Header locale={locale} />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          <div className="text-xs text-gray-500 mb-4">
            <Link href={`${prefix}/`} className="hover:text-[var(--color-accent)]">Início</Link>
            <span className="mx-2">/</span>
            <span>H2H</span>
            <span className="mx-2">/</span>
            <span>{p1.name} vs {p2.name}</span>
          </div>

          <h1 className="text-2xl md:text-4xl font-extrabold mb-2">
            {p1.name} <span className="text-gray-500">vs</span> {p2.name}
          </h1>
          <p className="text-gray-400 text-sm md:text-base mb-6 md:mb-8">
            Análise H2H · {p1.tour === p2.tour ? p1.tour.toUpperCase() : 'Cross-tour'} · ELOs proprietários TudoTénis
          </p>

          {/* Big H2H card */}
          <div className="stat-card p-5 md:p-8 mb-6">
            <div className="grid grid-cols-3 items-center gap-3 md:gap-6">
              <PlayerHeadCard p={p1} isFav={overallFav.id === p1.id} prefix={prefix} />
              <div className="text-center">
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
                  Modelo prevê (ELO geral)
                </div>
                <div className="text-2xl md:text-4xl font-extrabold mb-1">
                  <span className={overallProb1 >= 0.5 ? 'text-[var(--color-accent)]' : ''}>
                    {Math.round(overallProb1 * 100)}%
                  </span>
                  <span className="text-gray-600 mx-1 md:mx-2">/</span>
                  <span className={overallProb2 > 0.5 ? 'text-[var(--color-accent)]' : ''}>
                    {Math.round(overallProb2 * 100)}%
                  </span>
                </div>
                <div className="text-[10px] md:text-xs text-gray-500">
                  ELO {Math.round(displayElo(eloOverall1) ?? eloOverall1)} vs {Math.round(displayElo(eloOverall2) ?? eloOverall2)}
                </div>
                <div className="text-[10px] text-gray-600 mt-2 leading-relaxed">
                  Probabilidade de vencer o <strong className="text-gray-400">match</strong> em
                  formato BO3 (default ATP/WTA). Para Slams ATP (BO5),
                  consulta a{' '}
                  <Link href={`${prefix}/ferramentas/predictor`} className="text-[var(--color-accent)] hover:underline">
                    ferramenta Predictor
                  </Link>.
                </div>
              </div>
              <PlayerHeadCard p={p2} isFav={overallFav.id === p2.id} prefix={prefix} />
            </div>
          </div>

          {/* Trajectória ELO 12m — overlay dos 2 jogadores */}
          <H2HSparklineCompare
            p1={{ id: p1.id, name: p1.name, flag: p1.flag, photo_url: p1.photo_url }}
            p2={{ id: p2.id, name: p2.name, flag: p2.flag, photo_url: p2.photo_url }}
          />

          {/* Per-surface analysis */}
          <h2 className="text-xl font-bold mb-1">Probabilidade por superfície</h2>
          <p className="text-xs text-gray-500 mb-4">
            Probabilidade de vencer o match em BO3 (formato standard ATP/WTA).
          </p>
          <div className="grid sm:grid-cols-3 gap-3 md:gap-4 mb-8">
            {surfaceData.map(s => (
              <div key={s.key} className="stat-card p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase text-gray-500">{surfaceLabel(locale, s.key)}</span>
                  <span className={`surface-pill ${s.cls}`}>{surfaceLabel(locale, s.key)}</span>
                </div>
                <div className="text-2xl font-extrabold font-mono mb-2">
                  <span className={s.favIsP1 ? 'text-[var(--color-accent)]' : ''}>
                    {Math.round(s.prob1 * 100)}%
                  </span>
                  <span className="text-gray-600 text-base mx-1">/</span>
                  <span className={!s.favIsP1 ? 'text-[var(--color-accent)]' : ''}>
                    {Math.round(s.prob2 * 100)}%
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 mb-3">
                  ELO {Math.round(displayElo(s.e1) ?? s.e1)} vs {Math.round(displayElo(s.e2) ?? s.e2)}
                </div>
                <div className="pt-3 border-t border-[var(--color-border)] grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-gray-500">Quota P1</div>
                    <div className="font-mono font-semibold">{s.fairP1.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Quota P2</div>
                    <div className="font-mono font-semibold">{s.fairP2.toFixed(2)}</div>
                  </div>
                </div>
                {/* Mini sparkline 12m do ELO desta surface — P1 vs P2 overlay */}
                {surfaceHistory && (
                  <div className="pt-3 mt-3 border-t border-[var(--color-border)]">
                    <H2HSurfaceMiniSparkline
                      series={surfaceHistory[s.key as 'hard'|'clay'|'grass']}
                      p1Name={p1.name}
                      p2Name={p2.name}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Insight automático */}
          <div className="stat-card p-5 md:p-6 mb-6 border-[var(--color-accent)]/20">
            <h3 className="text-xs font-bold text-[var(--color-accent)] uppercase tracking-wider mb-2">
              Insight do modelo
            </h3>
            <p className="text-gray-300 text-sm md:text-base leading-relaxed">{insight}</p>
          </div>

          {/* Comparação rápida */}
          <h2 className="text-xl font-bold mb-4">Comparação rápida</h2>
          <div className="stat-card overflow-hidden mb-8">
            <table className="w-full text-sm">
              <tbody className="font-mono">
                <tr className="border-b border-[var(--color-border)]">
                  <td className="p-3 md:p-4 font-sans text-gray-500 text-xs uppercase">ELO geral</td>
                  <td className="text-center p-3 md:p-4 font-bold">{Math.round(displayElo(eloOverall1) ?? eloOverall1)}</td>
                  <td className="text-center p-3 md:p-4 font-bold">{Math.round(displayElo(eloOverall2) ?? eloOverall2)}</td>
                </tr>
                <tr className="border-b border-[var(--color-border)]">
                  <td className="p-3 md:p-4 font-sans text-gray-500 text-xs uppercase">Ranking</td>
                  <td className="text-center p-3 md:p-4">#{p1.atp_rank ?? '—'}</td>
                  <td className="text-center p-3 md:p-4">#{p2.atp_rank ?? '—'}</td>
                </tr>
                <tr className="border-b border-[var(--color-border)]">
                  <td className="p-3 md:p-4 font-sans text-gray-500 text-xs uppercase">Forma L5</td>
                  <td className="text-center p-3 md:p-4 text-xs">{p1.form_l5 ?? '—'}</td>
                  <td className="text-center p-3 md:p-4 text-xs">{p2.form_l5 ?? '—'}</td>
                </tr>
                <tr className="border-b border-[var(--color-border)]">
                  <td className="p-3 md:p-4 font-sans text-gray-500 text-xs uppercase">Títulos</td>
                  <td className="text-center p-3 md:p-4">{p1.titles}</td>
                  <td className="text-center p-3 md:p-4">{p2.titles}</td>
                </tr>
                <tr>
                  <td className="p-3 md:p-4 font-sans text-gray-500 text-xs uppercase">Slams</td>
                  <td className="text-center p-3 md:p-4">{p1.slams}</td>
                  <td className="text-center p-3 md:p-4">{p2.slams}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Quick CTAs */}
          <div className="grid sm:grid-cols-3 gap-3">
            <Link href={`${prefix}/jogador/${p1.slug}`} className="stat-card p-4 hover:border-[var(--color-accent)]/50">
              <div className="text-xs text-gray-500 mb-1">Perfil</div>
              <div className="font-semibold">{p1.name}</div>
            </Link>
            <Link href={`${prefix}/jogador/${p2.slug}`} className="stat-card p-4 hover:border-[var(--color-accent)]/50">
              <div className="text-xs text-gray-500 mb-1">Perfil</div>
              <div className="font-semibold">{p2.name}</div>
            </Link>
            <Link href={`${prefix}/ranking`} className="stat-card p-4 hover:border-[var(--color-accent)]/50">
              <div className="text-xs text-gray-500 mb-1">Ranking ELO</div>
              <div className="font-semibold">Ver top 10 →</div>
            </Link>
          </div>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
