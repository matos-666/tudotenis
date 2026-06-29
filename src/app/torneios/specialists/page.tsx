import type { Metadata } from 'next';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { hreflangAlternates, surfaceLabel, type Locale } from '@/lib/i18n';
import { displayElo } from '@/lib/elo';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Specialists por superfície · ELO clay, grass, hard',
  description:
    'Quem joga acima do seu nível em cada superfície. Top 30 clay specialists, grass specialists, hard specialists segundo o nosso modelo ELO próprio.',
  alternates: hreflangAlternates('/torneios/specialists'),
};

interface Row {
  slug: string;
  name: string;
  flag: string | null;
  photo_url: string | null;
  tour: string;
  elo_set_overall: number | null;
  elo_set_hard: number | null;
  elo_set_clay: number | null;
  elo_set_grass: number | null;
  set_count: number | null;
}

async function fetchSpecialists() {
  const { data } = await supabase
    .from('players')
    .select('slug, name, flag, photo_url, tour, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass, set_count')
    .eq('active', true)
    .gte('set_count', 100)              // mínimo de jogos para ranking ser fiável
    .not('elo_set_overall', 'is', null)
    .order('elo_set_overall', { ascending: false, nullsFirst: false })
    .limit(500);
  return (data ?? []) as Row[];
}

type Surface = 'clay' | 'grass' | 'hard';

function computeSpecialists(rows: Row[], surface: Surface, tour: 'atp' | 'wta', limit = 20) {
  const field = `elo_set_${surface}` as const;
  return rows
    .filter(p => p.tour === tour && p[field] != null && p.elo_set_overall != null)
    .map(p => ({
      ...p,
      residual: (p[field] as number) - (p.elo_set_overall as number),
      surfaceElo: p[field] as number,
    }))
    .filter(p => p.residual > 0)        // só specialists (acima do overall)
    .sort((a, b) => b.residual - a.residual)
    .slice(0, limit);
}

function PlayerAvatar({ src, flag, name }: { src: string | null; flag: string | null; name: string }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="relative w-9 h-9 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} loading="lazy" className="w-full h-full object-cover" style={{ objectPosition: 'top center' }} />
      ) : (
        <span className="text-[10px] font-bold text-gray-500">{initials}</span>
      )}
      {flag && (
        <span className="absolute bottom-0 right-0 text-[9px] leading-none bg-[var(--color-surface)] rounded-tl px-0.5" aria-hidden="true">
          {flag}
        </span>
      )}
    </div>
  );
}

function SpecialistRow({
  rank, p, surface, locale, prefix,
}: {
  rank: number;
  p: ReturnType<typeof computeSpecialists>[number];
  surface: Surface;
  locale: Locale;
  prefix: string;
}) {
  const displayOverall = Math.round(displayElo(p.elo_set_overall) ?? 0);
  const displaySurface = Math.round(displayElo(p.surfaceElo) ?? 0);
  const displayDiff = displaySurface - displayOverall;

  return (
    <Link
      href={`${prefix}/jogador/${p.slug}`}
      className="flex items-center gap-2 md:gap-3 p-2.5 md:p-3 border-t border-[var(--color-border)] hover:bg-[var(--color-card)]/40 transition"
    >
      <span className="text-xs text-gray-500 font-mono w-5 text-right shrink-0">{rank}</span>
      <PlayerAvatar src={p.photo_url} flag={p.flag} name={p.name} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{p.name}</div>
        <div className="hidden sm:block text-[10px] text-gray-500 font-mono">
          {displayOverall} → <span className="text-gray-300">{displaySurface}</span>
        </div>
      </div>
      <div className="text-right whitespace-nowrap shrink-0">
        <div className="text-sm font-mono font-bold text-[var(--color-accent)]">
          +{displayDiff}
        </div>
        <div className="text-[10px] text-gray-500">
          {surfaceLabel(locale, surface)}
        </div>
      </div>
    </Link>
  );
}

function SurfaceColumn({
  title, rows, surface, locale, prefix,
}: {
  title: string;
  rows: ReturnType<typeof computeSpecialists>;
  surface: Surface;
  locale: Locale;
  prefix: string;
}) {
  return (
    <div className="stat-card overflow-hidden">
      <div className="p-4 border-b border-[var(--color-border)]">
        <h3 className="font-bold">{title}</h3>
        <p className="text-xs text-gray-500 mt-1">
          ELO {surfaceLabel(locale, surface)} − ELO Geral (residual positivo)
        </p>
      </div>
      <div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Sem dados.</p>
        ) : (
          rows.map((p, i) => (
            <SpecialistRow
              key={p.slug}
              rank={i + 1}
              p={p}
              surface={surface}
              locale={locale}
              prefix={prefix}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default async function SpecialistsPage({ locale = 'pt-PT' as Locale }: { locale?: Locale } = {}) {
  const isBR = locale === 'pt-BR';
  const prefix = locale === 'pt-BR' ? '/br' : '';
  const rows = await fetchSpecialists();

  // ATP e WTA juntos para cada surface — pode ser por tour numa próxima versão
  const clayATP   = computeSpecialists(rows, 'clay',  'atp', 15);
  const clayWTA   = computeSpecialists(rows, 'clay',  'wta', 15);
  const grassATP  = computeSpecialists(rows, 'grass', 'atp', 15);
  const grassWTA  = computeSpecialists(rows, 'grass', 'wta', 15);
  const hardATP   = computeSpecialists(rows, 'hard',  'atp', 15);
  const hardWTA   = computeSpecialists(rows, 'hard',  'wta', 15);

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
            <span>Specialists</span>
          </div>

          <h1 className="text-2xl md:text-4xl font-extrabold mb-2">
            Specialists por superfície
          </h1>
          <p className="text-gray-400 text-sm md:text-base mb-8 max-w-3xl">
            {isBR
              ? 'Quem joga acima do seu nível geral em cada piso. Os números mostram quanto ELO o jogador tem a mais no piso vs no ranking overall — o residual positivo identifica o specialist verdadeiro.'
              : 'Quem joga acima do seu nível geral em cada superfície. Os números mostram quanto ELO o jogador tem a mais na superfície vs no ranking overall — o residual positivo identifica o specialist verdadeiro.'}
          </p>

          {/* Clay */}
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <span className="surface-pill surface-clay text-sm">
                {surfaceLabel(locale, 'clay')}
              </span>
              <h2 className="text-xl font-bold">Specialists de {surfaceLabel(locale, 'clay').toLowerCase()}</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <SurfaceColumn title="ATP — Masculino" rows={clayATP}  surface="clay" locale={locale} prefix={prefix} />
              <SurfaceColumn title="WTA — Feminino"  rows={clayWTA}  surface="clay" locale={locale} prefix={prefix} />
            </div>
          </section>

          {/* Grass */}
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <span className="surface-pill surface-grass text-sm">
                {surfaceLabel(locale, 'grass')}
              </span>
              <h2 className="text-xl font-bold">Specialists de {surfaceLabel(locale, 'grass').toLowerCase()}</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <SurfaceColumn title="ATP — Masculino" rows={grassATP} surface="grass" locale={locale} prefix={prefix} />
              <SurfaceColumn title="WTA — Feminino"  rows={grassWTA} surface="grass" locale={locale} prefix={prefix} />
            </div>
          </section>

          {/* Hard */}
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <span className="surface-pill surface-hard text-sm">Hard</span>
              <h2 className="text-xl font-bold">Specialists de hard</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <SurfaceColumn title="ATP — Masculino" rows={hardATP}  surface="hard" locale={locale} prefix={prefix} />
              <SurfaceColumn title="WTA — Feminino"  rows={hardWTA}  surface="hard" locale={locale} prefix={prefix} />
            </div>
          </section>

          <div className="flex flex-wrap gap-3 mt-8 pt-4 border-t border-[var(--color-border)]">
            <Link
              href={`${prefix}/torneios`}
              className="bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)] px-4 py-2 rounded-lg text-sm"
            >
              📅 Ver calendário de torneios
            </Link>
            <Link
              href={`${prefix}/ranking`}
              className="bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)] px-4 py-2 rounded-lg text-sm"
            >
              🏆 Ranking ELO overall
            </Link>
          </div>

          <p className="text-[11px] text-gray-500 mt-4">
            Filtros: jogadores activos com ≥100 sets no nosso histórico. ELO mostrado é match-equivalent (transformação de set-level ELO para escala TA-comparable).
          </p>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
