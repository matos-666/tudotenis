import type { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://tudotenis.com';

/**
 * Sitemap dinâmico — Next.js gera /sitemap.xml automaticamente.
 *
 * Inclui ambos os locales (pt-PT canonical + pt-BR sob /br/) com
 * `alternates.languages` para hreflang. O Google consome isto e
 * mostra a versão correcta por país.
 *
 * H2H pages (4950) deliberadamente omitidas — duplicate content
 * com baixo signal individual.
 */
type SitemapEntry = MetadataRoute.Sitemap[number];

function withAlternates(path: string, lastModified: Date, changeFrequency: SitemapEntry['changeFrequency'], priority: number): SitemapEntry {
  const ptUrl = `${BASE}${path}`;
  const brUrl = path === '' || path === '/' ? `${BASE}/br` : `${BASE}/br${path}`;
  return {
    url: ptUrl,
    lastModified,
    changeFrequency,
    priority,
    alternates: {
      languages: {
        'pt-PT': ptUrl,
        'pt-BR': brUrl,
        'x-default': ptUrl,
      },
    },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // ── Static pages ──
  const staticPaths: Array<[string, SitemapEntry['changeFrequency'], number]> = [
    ['',                       'daily',   1.0],
    ['/picks',                 'hourly',  0.95],
    ['/ranking',               'daily',   0.9],
    ['/jogadores',             'weekly',  0.85],
    // /h2h landing removed from nav — só URLs dinâmicos /h2h/[matchup] são indexados
    ['/torneios',              'daily',   0.85],
    ['/torneios/specialists',  'daily',   0.8],
    ['/ferramentas',           'monthly', 0.75],
    ['/ferramentas/predictor', 'monthly', 0.7],
    ['/ferramentas/kelly',     'monthly', 0.7],
    ['/como-funciona',         'monthly', 0.8],
    ['/historico',             'daily',   0.7],
  ];
  const staticPages: MetadataRoute.Sitemap = [];
  for (const [p, freq, pri] of staticPaths) {
    staticPages.push(withAlternates(p, now, freq, pri));
    // Também registamos /br/... como entradas separadas
    staticPages.push({
      url: `${BASE}/br${p}`,
      lastModified: now,
      changeFrequency: freq,
      priority: pri * 0.9, // BR um pouco abaixo até consolidar
      alternates: {
        languages: {
          'pt-PT': `${BASE}${p}`,
          'pt-BR': `${BASE}/br${p}`,
          'x-default': `${BASE}${p}`,
        },
      },
    });
  }

  // ── Players ──
  const { data: players } = await supabase
    .from('players')
    .select('slug, updated_at')
    .eq('active', true)
    .order('elo_overall', { ascending: false });

  const playerPages: MetadataRoute.Sitemap = (players ?? []).flatMap(p => {
    const lastModified = p.updated_at ? new Date(p.updated_at) : now;
    return [
      withAlternates(`/jogador/${p.slug}`, lastModified, 'weekly', 0.6),
      {
        url: `${BASE}/br/jogador/${p.slug}`,
        lastModified,
        changeFrequency: 'weekly' as const,
        priority: 0.55,
        alternates: {
          languages: {
            'pt-PT': `${BASE}/jogador/${p.slug}`,
            'pt-BR': `${BASE}/br/jogador/${p.slug}`,
            'x-default': `${BASE}/jogador/${p.slug}`,
          },
        },
      },
    ];
  });

  // ── Tournaments ──
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('slug, updated_at, category, surface, year')
    .in('category', ['slam', '1000', '500', '250', 'finals'])
    .order('year', { ascending: false });

  const tournamentPages: MetadataRoute.Sitemap = (tournaments ?? []).flatMap(t => {
    const lastModified = t.updated_at ? new Date(t.updated_at) : now;
    return [
      withAlternates(`/torneios/${t.slug}`, lastModified, 'monthly', 0.55),
      {
        url: `${BASE}/br/torneios/${t.slug}`,
        lastModified,
        changeFrequency: 'monthly' as const,
        priority: 0.5,
        alternates: {
          languages: {
            'pt-PT': `${BASE}/torneios/${t.slug}`,
            'pt-BR': `${BASE}/br/torneios/${t.slug}`,
            'x-default': `${BASE}/torneios/${t.slug}`,
          },
        },
      },
    ];
  });

  // ── Insight pages (preparacao + predictor) — só slams + 1000s com surface
  //    suportada (hard/clay/grass/indoor)
  const insightTournaments = (tournaments ?? []).filter(t =>
    (t.category === 'slam' || t.category === '1000') &&
    t.surface && ['hard', 'clay', 'grass', 'indoor'].includes(t.surface)
  );

  const insightPages: MetadataRoute.Sitemap = insightTournaments.flatMap(t => {
    const lastModified = t.updated_at ? new Date(t.updated_at) : now;
    // Recent / future torneios = mais prioritários (changefreq weekly)
    const isRecent = t.year && t.year >= 2024;
    const freq: SitemapEntry['changeFrequency'] = isRecent ? 'weekly' : 'monthly';
    const out: MetadataRoute.Sitemap = [];
    for (const subpath of ['/preparacao', '/predictor']) {
      const path = `/torneios/${t.slug}${subpath}`;
      out.push(withAlternates(path, lastModified, freq, isRecent ? 0.7 : 0.5));
      out.push({
        url: `${BASE}/br${path}`,
        lastModified,
        changeFrequency: freq,
        priority: isRecent ? 0.65 : 0.45,
        alternates: {
          languages: {
            'pt-PT': `${BASE}${path}`,
            'pt-BR': `${BASE}/br${path}`,
            'x-default': `${BASE}${path}`,
          },
        },
      });
    }
    return out;
  });

  return [...staticPages, ...playerPages, ...tournamentPages, ...insightPages];
}
