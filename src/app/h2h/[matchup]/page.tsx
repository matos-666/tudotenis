import { notFound, redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { eloProb, fairOdds, parseMatchupSlug, displayElo, buildMatchupSlug } from '@/lib/elo';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { breadcrumbJsonLd } from '@/lib/jsonld';
import { H2HSparklineCompare } from '@/components/H2HSparklineCompare';
import { H2HSurfaceMiniSparkline } from '@/components/H2HSurfaceMiniSparkline';
import { fetchH2HSurfaceHistory } from '@/lib/h2h-surface-history';
import { hreflangAlternates, surfaceLabel, type Locale } from '@/lib/i18n';

export const revalidate = 3600;

interface Player {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  country: string | null;
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
  birth_date: string | null;
  height_cm: number | null;
  hand: string | null;
  career_high_atp: number | null;
}

// ── Helpers visuais para a comparação ────────────────────────────────────

function ageFromBirthDate(b: string | null): number | null {
  if (!b) return null;
  const bd = new Date(b);
  const now = new Date();
  let a = now.getFullYear() - bd.getFullYear();
  const m = now.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) a--;
  return a > 5 && a < 60 ? a : null;
}

function handLabel(h: string | null): string {
  if (!h) return '—';
  const x = h.toLowerCase();
  if (x.startsWith('r')) return 'Direita';
  if (x.startsWith('l')) return 'Esquerda';
  return h;
}

/**
 * Linha de comparação 1-vs-1 com barra visual:
 *  - Label central
 *  - Valor p1 à esquerda, p2 à direita
 *  - Barra horizontal com fill proporcional para cada lado
 *  - O lado com vantagem fica destacado
 *
 * mode='higher-better' (default): valor maior = melhor
 * mode='lower-better': valor menor = melhor (ranking)
 */
function VsRow({
  label,
  v1,
  v2,
  display1,
  display2,
  mode = 'higher-better',
  showBar = true,
}: {
  label: string;
  v1: number | null;
  v2: number | null;
  display1?: React.ReactNode;
  display2?: React.ReactNode;
  mode?: 'higher-better' | 'lower-better';
  showBar?: boolean;
}) {
  const d1 = display1 ?? (v1 == null ? '—' : v1);
  const d2 = display2 ?? (v2 == null ? '—' : v2);
  let p1Leads = false;
  let p2Leads = false;
  let ratio1 = 0.5;
  if (v1 != null && v2 != null) {
    const better1 = mode === 'higher-better' ? v1 > v2 : v1 < v2;
    const better2 = mode === 'higher-better' ? v2 > v1 : v1 > v2;
    p1Leads = better1;
    p2Leads = better2;
    if (showBar && v1 + v2 > 0) {
      const a = Math.max(1, mode === 'higher-better' ? v1 : 1 / v1);
      const b = Math.max(1, mode === 'higher-better' ? v2 : 1 / v2);
      ratio1 = a / (a + b);
    }
  }
  return (
    <div className="px-3 md:px-5 py-3 md:py-4 border-b border-[var(--color-border)] last:border-b-0">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className={`text-sm md:text-base font-mono font-semibold text-right ${p1Leads ? 'text-[var(--color-accent)]' : 'text-gray-300'}`}>
          {d1}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold px-2">
          {label}
        </div>
        <div className={`text-sm md:text-base font-mono font-semibold text-left ${p2Leads ? 'text-[var(--color-accent)]' : 'text-gray-300'}`}>
          {d2}
        </div>
      </div>
      {showBar && v1 != null && v2 != null && (
        <div className="mt-2 h-1 rounded-full overflow-hidden bg-[var(--color-card)] flex">
          <div
            className={p1Leads ? 'bg-[var(--color-accent)]' : 'bg-gray-600'}
            style={{ width: `${(ratio1 * 100).toFixed(1)}%` }}
          />
          <div
            className={p2Leads ? 'bg-[var(--color-accent)]' : 'bg-gray-600'}
            style={{ width: `${((1 - ratio1) * 100).toFixed(1)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Pills V/D coloridos para a "Forma L5". Aceita "VVVDV", "WWLWW". */
function FormPills({ f, align = 'center' }: { f: string | null; align?: 'left' | 'right' | 'center' }) {
  if (!f) return <span className="text-gray-500">—</span>;
  const chars = f.replace(/[^VWDL]/gi, '').toUpperCase().slice(-5);
  const justifyClass = align === 'right' ? 'justify-end' : align === 'left' ? 'justify-start' : 'justify-center';
  return (
    <span className={`inline-flex gap-1 ${justifyClass} w-full`}>
      {chars.split('').map((c, i) => {
        const win = c === 'V' || c === 'W';
        return (
          <span
            key={i}
            className={`inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-extrabold ${
              win
                ? 'bg-[var(--color-accent)] text-[var(--color-surface)] shadow shadow-[var(--color-accent)]/30'
                : 'bg-red-500 text-white shadow shadow-red-500/30'
            }`}
            aria-label={win ? 'Vitória' : 'Derrota'}
          >
            {win ? 'V' : 'D'}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Narrativa SEO-friendly gerada a partir dos dados — 3-4 parágrafos de texto
 * em PT-PT mencionando especialidade de cada player, momento, vantagem ELO,
 * idade etc. Boa para indexação Google + AI search bots.
 */
function H2HNarrative({
  p1, p2, ovr, surfElo, momentum, age,
}: {
  p1: Player;
  p2: Player;
  ovr: [number, number];
  surfElo: { hard: [number, number]; clay: [number, number]; grass: [number, number] };
  momentum: [number | null, number | null];
  age: [number | null, number | null];
}) {
  const last1 = p1.name.split(' ').slice(-1)[0];
  const last2 = p2.name.split(' ').slice(-1)[0];
  const diff = ovr[0] - ovr[1];
  const absDiff = Math.abs(diff);
  const leader = diff > 0 ? p1 : p2;
  const leaderLast = diff > 0 ? last1 : last2;
  const underdog = diff > 0 ? p2 : p1;
  const underdogLast = diff > 0 ? last2 : last1;

  // Melhor surface de cada (a que tem ELO maior em relação ao seu overall)
  function bestSurface(p: Player, ovrVal: number, surfs: [number, number]): string | null {
    const items: Array<[string, number]> = [
      ['hard', surfElo.hard[surfs[0]]],
      ['terra batida', surfElo.clay[surfs[0]]],
      ['relvado', surfElo.grass[surfs[0]]],
    ];
    const filtered = items.filter(([, v]) => v > ovrVal + 15);
    if (!filtered.length) return null;
    filtered.sort((a, b) => b[1] - a[1]);
    return filtered[0][0];
  }
  const best1 = bestSurface(p1, ovr[0], [0, 0]);
  const best2 = bestSurface(p2, ovr[1], [1, 1]);

  // Momento texto
  function momentumText(m: number | null, last: string): string | null {
    if (m == null) return null;
    if (m > 30)  return `${last} está em grande momento (+${Math.round(m)} ELO nos últimos 30 dias)`;
    if (m > 10)  return `${last} vem em subida (+${Math.round(m)} ELO em 30d)`;
    if (m < -30) return `${last} está em queda acentuada (${Math.round(m)} ELO em 30d)`;
    if (m < -10) return `${last} tem perdido terreno (${Math.round(m)} ELO em 30d)`;
    return null;
  }
  const mom1Text = momentumText(momentum[0], last1);
  const mom2Text = momentumText(momentum[1], last2);

  // Diferença em probabilidade
  const probGap = absDiff > 200 ? 'enorme' : absDiff > 100 ? 'significativa' : absDiff > 50 ? 'moderada' : 'pequena';

  // Idade
  const ageText = age[0] && age[1]
    ? age[0] === age[1]
      ? `Ambos têm ${age[0]} anos.`
      : `${last1} tem ${age[0]} anos${age[0] < age[1] ? ' (mais novo)' : ''}, ${last2} tem ${age[1]} anos${age[1] < age[0] ? ' (mais novo)' : ''}.`
    : null;

  // Slams
  const slamsText = (p1.slams > 0 || p2.slams > 0)
    ? (p1.slams === p2.slams
        ? null
        : p1.slams > p2.slams
          ? `${last1} tem ${p1.slams} Grand Slam${p1.slams > 1 ? 's' : ''} no currículo — vantagem clara de experiência em majors.`
          : `${last2} tem ${p2.slams} Grand Slam${p2.slams > 1 ? 's' : ''} no currículo — vantagem clara de experiência em majors.`)
    : null;

  return (
    <div className="mt-2 mb-8">
      <h2 className="text-xl font-bold mb-3">Análise do confronto</h2>
      <div className="stat-card p-5 md:p-6 space-y-3 text-sm md:text-base text-gray-300 leading-relaxed">
        <p>
          <strong className="text-white">{p1.name}</strong>
          {p1.country && <> ({p1.country})</>}
          {' '}enfrenta{' '}
          <strong className="text-white">{p2.name}</strong>
          {p2.country && <> ({p2.country})</>}
          {' '}com uma diferença de ELO {probGap}{' '}({absDiff} pontos a favor de {leaderLast}).
          {' '}{leaderLast} chega como favorito do modelo (ELO {ovr[diff > 0 ? 0 : 1]} vs {ovr[diff > 0 ? 1 : 0]} de {underdogLast}).
        </p>

        {(best1 || best2) && (
          <p>
            {best1 && (
              <>
                <strong className="text-white">{last1}</strong> destaca-se em <strong>{best1}</strong> (ELO {
                  best1 === 'hard' ? surfElo.hard[0] : best1 === 'terra batida' ? surfElo.clay[0] : surfElo.grass[0]
                }, acima do seu ELO geral de {ovr[0]}).{' '}
              </>
            )}
            {best2 && (
              <>
                {best1 ? '' : ''}<strong className="text-white">{last2}</strong> tem a sua melhor superfície em <strong>{best2}</strong> (ELO {
                  best2 === 'hard' ? surfElo.hard[1] : best2 === 'terra batida' ? surfElo.clay[1] : surfElo.grass[1]
                }).
              </>
            )}
          </p>
        )}

        {(mom1Text || mom2Text) && (
          <p>
            {mom1Text && <>{mom1Text}. </>}
            {mom2Text && <>{mom2Text}. </>}
            {!mom1Text && !mom2Text ? null : 'Tendência recente é um indicador relevante para confrontos próximos.'}
          </p>
        )}

        {slamsText && <p>{slamsText}</p>}

        {ageText && (p1.career_high_atp || p2.career_high_atp) && (
          <p>
            {ageText}
            {p1.career_high_atp && <> {last1} já foi #{p1.career_high_atp} no mundo.</>}
            {p2.career_high_atp && <> {last2} chegou ao #{p2.career_high_atp}.</>}
          </p>
        )}

      </div>
    </div>
  );
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
    .select('id, slug, name, flag, country, tour, atp_rank, photo_url, elo_overall, elo_hard, elo_clay, elo_grass, elo_indoor, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass, elo_30d_ago, form_l5, titles, slams, birth_date, height_cm, hand, career_high_atp')
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
  locale = 'pt-PT',
}: {
  params: Promise<{ matchup: string }>;
  locale?: Locale;
}) {
  const { matchup } = await params;
  const prefix = locale === 'pt-BR' ? '/br' : '';

  // Single-player slug (sem "-vs-" e player existe) → redirect para perfil
  if (!matchup.includes('-vs-') && !matchup.includes('-')) {
    redirect(`${prefix}/jogador/${matchup}`);
  }

  const pair = await fetchPair(matchup);

  // Se não conseguiu parsear como par mas é um slug válido de player → redirect
  if (!pair) {
    // Short last-name fallback: /h2h/alcaraz-vs-sinner → 301 canonical
    if (matchup.includes('-vs-')) {
      const [shortA, shortB] = matchup.split('-vs-');
      const allSlugs = await fetchAllSlugs();
      const matchA = [...allSlugs].filter(s => s === shortA || s.endsWith(`-${shortA}`));
      const matchB = [...allSlugs].filter(s => s === shortB || s.endsWith(`-${shortB}`));
      if (matchA.length === 1 && matchB.length === 1 && matchA[0] !== matchB[0]) {
        redirect(`${prefix}/h2h/${buildMatchupSlug(matchA[0], matchB[0])}`);
      }
    }
    const { data } = await supabase
      .from('players')
      .select('slug')
      .eq('slug', matchup)
      .maybeSingle();
    if (data) redirect(`${prefix}/jogador/${matchup}`);
    notFound();
  }

  const { p1, p2 } = pair;

  // Momento 30d via elo_history (snapshot semanal mais recente vs ~30d atrás).
  // O legacy players.elo_30d_ago está congelado em Nov 2025 — inútil agora.
  const momentum30d: Record<number, number | null> = {};
  {
    const since = new Date();
    since.setDate(since.getDate() - 45); // janela de 45d para apanhar snapshot ~30d ago
    const { data: history } = await supabase
      .from('elo_history')
      .select('player_id, date, elo_set_overall, elo_overall')
      .in('player_id', [p1.id, p2.id])
      .gte('date', since.toISOString().slice(0, 10))
      .order('date', { ascending: true });
    const byPlayer = new Map<number, Array<{ date: string; val: number }>>();
    for (const r of (history ?? []) as Array<{ player_id: number; date: string; elo_set_overall: number | null; elo_overall: number | null }>) {
      const v = (r.elo_set_overall ?? r.elo_overall);
      if (v == null) continue;
      if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
      byPlayer.get(r.player_id)!.push({ date: r.date, val: Number(v) });
    }
    for (const pid of [p1.id, p2.id]) {
      const pts = byPlayer.get(pid) ?? [];
      if (pts.length < 2) { momentum30d[pid] = null; continue; }
      const latest = pts[pts.length - 1].val;
      const oldest = pts[0].val;
      momentum30d[pid] = latest - oldest;
    }
  }

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

          {/* ── Comparação detalhada ─────────────────────────────────── */}
          {(() => {
            // Calcula display-ELO para cada surface (todos passam por displayElo
            // para ficarem na mesma escala do site).
            const ovr1 = Math.round(displayElo(eloFor(p1, 'overall')) ?? 1500);
            const ovr2 = Math.round(displayElo(eloFor(p2, 'overall')) ?? 1500);
            const hard1 = Math.round(displayElo(eloFor(p1, 'hard')) ?? 1500);
            const hard2 = Math.round(displayElo(eloFor(p2, 'hard')) ?? 1500);
            const clay1 = Math.round(displayElo(eloFor(p1, 'clay')) ?? 1500);
            const clay2 = Math.round(displayElo(eloFor(p2, 'clay')) ?? 1500);
            const grass1 = Math.round(displayElo(eloFor(p1, 'grass')) ?? 1500);
            const grass2 = Math.round(displayElo(eloFor(p2, 'grass')) ?? 1500);

            // Momento (Δ ~30d) — vem do elo_history (snapshots semanais),
            // não do players.elo_30d_ago legacy (congelado em Nov 2025).
            const mom1Raw = momentum30d[p1.id];
            const mom2Raw = momentum30d[p2.id];
            // Round to int para display
            const mom1 = mom1Raw != null ? Math.round(mom1Raw) : null;
            const mom2 = mom2Raw != null ? Math.round(mom2Raw) : null;

            const age1 = ageFromBirthDate(p1.birth_date);
            const age2 = ageFromBirthDate(p2.birth_date);

            return (
              <>
                <h2 className="text-xl font-bold mb-1">Comparação detalhada</h2>
                <p className="text-xs text-gray-500 mb-4">
                  Verde = vantagem nesse parâmetro. Barra mostra a magnitude da diferença.
                </p>
                {/* ELO por superfície */}
                <div className="stat-card mb-4">
                  <div className="px-3 md:px-5 py-2.5 bg-[var(--color-card)] border-b border-[var(--color-border)]">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">📊 ELO por superfície</span>
                  </div>
                  <VsRow label="Geral"   v1={ovr1}   v2={ovr2}   />
                  <VsRow label="Hard"    v1={hard1}  v2={hard2}  />
                  <VsRow label="Terra"   v1={clay1}  v2={clay2}  />
                  <VsRow label="Relva"   v1={grass1} v2={grass2} />
                </div>

                {/* Forma / Momento */}
                <div className="stat-card mb-4">
                  <div className="px-3 md:px-5 py-2.5 bg-[var(--color-card)] border-b border-[var(--color-border)]">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">🔥 Forma & ranking</span>
                  </div>
                  <VsRow
                    label="Momento 30d"
                    v1={mom1} v2={mom2}
                    display1={mom1 == null ? '—' : (
                      <span className={mom1 > 5 ? 'text-[var(--color-accent)]' : mom1 < -5 ? 'text-red-400' : ''}>
                        {mom1 > 0 ? '+' : ''}{mom1}
                      </span>
                    )}
                    display2={mom2 == null ? '—' : (
                      <span className={mom2 > 5 ? 'text-[var(--color-accent)]' : mom2 < -5 ? 'text-red-400' : ''}>
                        {mom2 > 0 ? '+' : ''}{mom2}
                      </span>
                    )}
                  />
                  <VsRow
                    label="Forma últimos 5"
                    v1={(p1.form_l5 ?? '').split('').filter(c => c === 'V' || c === 'W').length}
                    v2={(p2.form_l5 ?? '').split('').filter(c => c === 'V' || c === 'W').length}
                    display1={<FormPills f={p1.form_l5} />}
                    display2={<FormPills f={p2.form_l5} />}
                  />
                  <VsRow
                    label="Ranking ATP/WTA"
                    v1={p1.atp_rank ?? 9999} v2={p2.atp_rank ?? 9999}
                    display1={p1.atp_rank ? `#${p1.atp_rank}` : '—'}
                    display2={p2.atp_rank ? `#${p2.atp_rank}` : '—'}
                    mode="lower-better"
                  />
                  <VsRow
                    label="Career high"
                    v1={p1.career_high_atp ?? 9999} v2={p2.career_high_atp ?? 9999}
                    display1={p1.career_high_atp ? `#${p1.career_high_atp}` : '—'}
                    display2={p2.career_high_atp ? `#${p2.career_high_atp}` : '—'}
                    mode="lower-better"
                  />
                </div>

                {/* Carreira & perfil */}
                <div className="stat-card mb-8">
                  <div className="px-3 md:px-5 py-2.5 bg-[var(--color-card)] border-b border-[var(--color-border)]">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-accent)]">🏆 Carreira</span>
                  </div>
                  <VsRow label="Títulos ATP/WTA" v1={p1.titles} v2={p2.titles} />
                  <VsRow label="Grand Slams"      v1={p1.slams}  v2={p2.slams}  />
                  <VsRow
                    label="Idade"
                    v1={null} v2={null}
                    display1={age1 ? `${age1} anos` : '—'}
                    display2={age2 ? `${age2} anos` : '—'}
                    showBar={false}
                  />
                  <VsRow
                    label="Mão dominante"
                    v1={null} v2={null}
                    display1={handLabel(p1.hand)}
                    display2={handLabel(p2.hand)}
                    showBar={false}
                  />
                  <VsRow
                    label="Altura"
                    v1={null} v2={null}
                    display1={p1.height_cm ? `${p1.height_cm} cm` : '—'}
                    display2={p2.height_cm ? `${p2.height_cm} cm` : '—'}
                    showBar={false}
                  />
                </div>

                {/* SEO narrative */}
                <H2HNarrative p1={p1} p2={p2}
                  ovr={[ovr1, ovr2]}
                  surfElo={{ hard: [hard1, hard2], clay: [clay1, clay2], grass: [grass1, grass2] }}
                  momentum={[mom1, mom2]}
                  age={[age1, age2]}
                />
              </>
            );
          })()}

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
