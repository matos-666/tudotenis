import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { hreflangAlternates, surfaceLabel, type Locale } from '@/lib/i18n';
import { displayElo, eloProb, matchProbFromSetProb } from '@/lib/elo';
import { ModelVsMarketScatter, type ModelEntry } from '@/components/ModelVsMarketScatter';

export const revalidate = 3600;

interface Tournament {
  id: number;
  slug: string;
  name: string;
  full_name: string | null;
  year: number;
  tour: string;
  category: string | null;
  surface: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface ContenderRow {
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
}

async function fetchTournament(slug: string): Promise<Tournament | null> {
  const { data } = await supabase
    .from('tournaments')
    .select('id,slug,name,full_name,year,tour,category,surface,start_date,end_date')
    .eq('slug', slug)
    .single();
  return data;
}

async function fetchContenders(tour: string): Promise<ContenderRow[]> {
  const tours = tour === 'both' ? ['atp', 'wta'] : [tour];
  const out: ContenderRow[] = [];
  for (const tt of tours) {
    const { data } = await supabase
      .from('players')
      .select('id,slug,name,flag,photo_url,atp_rank,elo_set_overall,elo_set_hard,elo_set_clay,elo_set_grass')
      .eq('tour', tt)
      .eq('active', true)
      .gte('set_count', 100)
      .not('elo_set_overall', 'is', null)
      .order('elo_set_overall', { ascending: false, nullsFirst: false })
      .limit(32);
    out.push(...(data ?? []) as ContenderRow[]);
  }
  return out;
}

export async function generateStaticParams() {
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
  return {
    title: `Predictor ${t.full_name ?? t.name} · Probabilidade de vencer · TudoTénis`,
    description: `Simulação Monte Carlo para ${t.full_name ?? t.name} ${t.year}. Probabilidade de cada top contender vencer o título segundo o nosso modelo ELO.`,
    alternates: hreflangAlternates(`/torneios/${slug}/predictor`),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Monte Carlo helper — simula um knockout draw com top N contenders.
// Sem o draw real, usamos shuffle aleatório por iteração.
// ─────────────────────────────────────────────────────────────────────────

interface SimPlayer {
  slug: string;
  name: string;
  elo: number;
  meta: ContenderRow;
}

function setProbVs(a: number, b: number): number {
  return eloProb(a, b);
}

function matchProb(eloA: number, eloB: number, bo: 3 | 5): number {
  return matchProbFromSetProb(setProbVs(eloA, eloB), bo);
}

/** Determina o vencedor pseudo-aleatório de um match. */
function simMatch(a: SimPlayer, b: SimPlayer, bo: 3 | 5): SimPlayer {
  const p = matchProb(a.elo, b.elo, bo);
  return Math.random() < p ? a : b;
}

interface SimResult {
  slug: string;
  name: string;
  meta: ContenderRow;
  champion: number;
  finalist: number;
  semi: number;
  qf: number;
}

function runMonteCarlo(players: SimPlayer[], rounds: number, simulations: number, bo: 3 | 5): SimResult[] {
  // Ajusta lista para potência de 2 (pad com placeholders nunca usados)
  const size = Math.pow(2, Math.ceil(Math.log2(players.length)));
  // padding com cópias (nunca jogadas — seriam byes)
  const padded: SimPlayer[] = [...players];
  while (padded.length < size) {
    padded.push({ slug: `__bye_${padded.length}`, name: 'BYE', elo: 0, meta: {} as ContenderRow });
  }

  const accum = new Map<string, { champion: number; finalist: number; semi: number; qf: number }>();
  for (const p of players) accum.set(p.slug, { champion: 0, finalist: 0, semi: 0, qf: 0 });

  for (let s = 0; s < simulations; s++) {
    // Shuffle aleatório (Fisher-Yates) — proxy de "sorteio random"
    const draw = [...padded];
    for (let i = draw.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [draw[i], draw[j]] = [draw[j], draw[i]];
    }

    let current = draw;
    let roundIdx = 0;
    while (current.length > 1) {
      const next: SimPlayer[] = [];
      for (let i = 0; i < current.length; i += 2) {
        const a = current[i];
        const b = current[i + 1];
        if (a.elo === 0) { next.push(b); continue; }
        if (b.elo === 0) { next.push(a); continue; }
        next.push(simMatch(a, b, bo));
      }
      const remaining = next.length;
      // Tracking rounds: si só restam 8 = QF começa, 4 = SF, 2 = F, 1 = winner
      if (remaining === 8) for (const p of current) if (accum.has(p.slug)) accum.get(p.slug)!.qf++;
      if (remaining === 4) for (const p of current) if (accum.has(p.slug)) accum.get(p.slug)!.semi++;
      if (remaining === 2) for (const p of current) if (accum.has(p.slug)) accum.get(p.slug)!.finalist++;
      if (remaining === 1) {
        const winner = next[0];
        if (accum.has(winner.slug)) accum.get(winner.slug)!.champion++;
      }
      current = next;
      roundIdx++;
      if (roundIdx > rounds + 2) break;   // safety
    }
  }

  const results: SimResult[] = players.map(p => ({
    slug: p.slug,
    name: p.name,
    meta: p.meta,
    ...accum.get(p.slug)!,
  }));
  return results.sort((a, b) => b.champion - a.champion);
}

// ─────────────────────────────────────────────────────────────────────────

export default async function PredictorPage({
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

  const isAtpSlam = t.category === 'slam' && t.tour === 'atp';
  const bo: 3 | 5 = isAtpSlam ? 5 : 3;

  const contenders = await fetchContenders(t.tour);
  const surfField = `elo_set_${surfForRating}` as const;

  // Top 32 by surface ELO específico
  const top32 = contenders
    .filter(c => c[surfField] != null)
    .sort((a, b) => (b[surfField] as number) - (a[surfField] as number))
    .slice(0, 32);

  const simPlayers: SimPlayer[] = top32.map(c => ({
    slug: c.slug,
    name: c.name,
    elo: c[surfField] as number,
    meta: c,
  }));

  // Monte Carlo: 5000 simulações (suficiente para tabela; 32→5 rounds)
  const results = runMonteCarlo(simPlayers, 5, 5000, bo);
  const SIMS = 5000;

  // Mapa player_id → {P(champion), name, slug} para o scatter Modelo vs Mercado.
  // O scatter só renderiza se houver outright_odds para este torneio (returna
  // null se a tabela estiver vazia).
  const modelByPlayerId = new Map<number, ModelEntry>();
  for (const r of results) {
    const meta = r.meta as ContenderRow;
    if (meta.id == null) continue;
    modelByPlayerId.set(meta.id, {
      p: r.champion / SIMS,
      name: r.name,
      slug: r.slug,
    });
  }

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
            <span>Predictor</span>
          </div>

          <h1 className="text-2xl md:text-4xl font-extrabold mb-2">
            Predictor · {t.full_name ?? t.name}
          </h1>
          <p className="text-gray-400 text-sm md:text-base mb-6 max-w-3xl">
            {isBR
              ? `Probabilidade de cada um dos 32 top contenders vencer o título, com base em ${SIMS.toLocaleString('pt-BR')} simulações Monte Carlo do bracket. Formato ${bo === 5 ? 'BO5 (Grand Slam ATP)' : 'BO3'} · piso ${surfaceLabel(locale, surfForRating)}.`
              : `Probabilidade de cada um dos 32 top contenders vencer o título, baseado em ${SIMS.toLocaleString('pt-PT')} simulações Monte Carlo do bracket. Formato ${bo === 5 ? 'BO5 (Grand Slam ATP)' : 'BO3'} · superfície ${surfaceLabel(locale, surfForRating)}.`}
          </p>

          <div className="stat-card p-4 mb-6 border-[var(--color-accent)]/20">
            <h3 className="text-xs font-bold text-[var(--color-accent)] uppercase tracking-wider mb-2">
              ⚠️ Limitações desta simulação
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              {isBR
                ? 'Esta versão não usa o draw real do torneio — em cada uma das 5.000 iterações, o bracket é resorteado aleatoriamente entre os top 32 por ELO de piso. Quando o draw oficial é publicado, esta página será atualizada para usar o pareamento real.'
                : 'Esta versão não usa o draw real do torneio — em cada uma das 5.000 iterações, o bracket é re-sorteado aleatoriamente entre os top 32 por ELO de surface. Quando o draw oficial for publicado, esta página passa a usar o pareamento real.'}
            </p>
          </div>

          {/* Modelo vs Mercado — só renderiza se houver outright_odds no DB */}
          <ModelVsMarketScatter
            tournamentId={t.id}
            modelByPlayerId={modelByPlayerId}
            prefix={prefix}
          />

          {/* Top contenders table */}
          <div className="stat-card overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-[var(--color-surface)] text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left p-2 md:p-3">#</th>
                  <th className="text-left p-2 md:p-3">Jogador</th>
                  <th className="hidden lg:table-cell text-right p-3">ELO {surfaceLabel(locale, surfForRating)}</th>
                  <th className="hidden sm:table-cell text-right p-2 md:p-3">P(QF)</th>
                  <th className="hidden sm:table-cell text-right p-2 md:p-3">P(SF)</th>
                  <th className="text-right p-2 md:p-3">P(Final)</th>
                  <th className="text-right p-2 md:p-3">P(Campeão)</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 16).map((r, i) => {
                  const pChamp = r.champion / SIMS;
                  const pFinal = r.finalist / SIMS;
                  const pSemi  = r.semi / SIMS;
                  const pQf    = r.qf / SIMS;
                  const displayELO = Math.round(displayElo(r.meta[surfField]) ?? 0);
                  return (
                    <tr key={r.slug} className="border-t border-[var(--color-border)] hover:bg-[var(--color-card)]/40">
                      <td className="p-2 md:p-3 text-xs font-mono text-gray-500">{i + 1}</td>
                      <td className="p-2 md:p-3">
                        <Link href={`${prefix}/jogador/${r.slug}`} className="flex items-center gap-2 hover:text-[var(--color-accent)] min-w-0">
                          <span className="text-base shrink-0">{r.meta.flag ?? ''}</span>
                          <span className="font-semibold truncate">{r.name}</span>
                        </Link>
                      </td>
                      <td className="hidden lg:table-cell text-right p-3 font-mono text-xs">{displayELO}</td>
                      <td className="hidden sm:table-cell text-right p-2 md:p-3 font-mono text-xs text-gray-400">{(pQf * 100).toFixed(0)}%</td>
                      <td className="hidden sm:table-cell text-right p-2 md:p-3 font-mono text-xs text-gray-400">{(pSemi * 100).toFixed(0)}%</td>
                      <td className="text-right p-2 md:p-3 font-mono text-xs">{(pFinal * 100).toFixed(1)}%</td>
                      <td className="text-right p-2 md:p-3 font-mono font-bold text-[var(--color-accent)]">
                        {(pChamp * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* CTA */}
          <div className="flex flex-wrap gap-3 mt-8">
            <Link
              href={`${prefix}/torneios/${t.slug}`}
              className="bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)] px-4 py-3 rounded-lg text-sm"
            >
              ← Página do torneio
            </Link>
            <Link
              href={`${prefix}/torneios/${t.slug}/preparacao`}
              className="bg-[var(--color-accent)] text-[var(--color-surface)] px-4 py-3 rounded-lg text-sm font-semibold"
            >
              🎯 Preparação para o torneio
            </Link>
          </div>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
