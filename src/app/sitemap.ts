import type { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://tudotenis.com';

/**
 * Sitemap dinâmico — Next.js gera /sitemap.xml automaticamente.
 *
 * Inclui:
 *   - Páginas estáticas (alta prioridade)
 *   - Todos os jogadores activos (~1000)
 *   - Todos os torneios principais (slam/M1000/500/250) ~1000
 *
 * H2H pages (4950) são deliberadamente omitidas — duplicate content
 * com baixo signal individual; vale mais ranking nas páginas-mãe.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // ── Static pages ──
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE,                         lastModified: now, changeFrequency: 'daily',  priority: 1.0 },
    { url: `${BASE}/picks`,              lastModified: now, changeFrequency: 'hourly', priority: 0.95 },
    { url: `${BASE}/ranking`,            lastModified: now, changeFrequency: 'daily',  priority: 0.9 },
    { url: `${BASE}/jogadores`,          lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE}/h2h`,                lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/torneios`,           lastModified: now, changeFrequency: 'daily',  priority: 0.85 },
    { url: `${BASE}/ferramentas`,        lastModified: now, changeFrequency: 'monthly', priority: 0.75 },
    { url: `${BASE}/ferramentas/predictor`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/ferramentas/kelly`,  lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/como-funciona`,      lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/historico`,          lastModified: now, changeFrequency: 'daily',  priority: 0.7 },
  ];

  // ── Players ──
  const { data: players } = await supabase
    .from('players')
    .select('slug, updated_at')
    .eq('active', true)
    .order('elo_overall', { ascending: false });

  const playerPages: MetadataRoute.Sitemap = (players ?? []).map(p => ({
    url: `${BASE}/jogador/${p.slug}`,
    lastModified: p.updated_at ? new Date(p.updated_at) : now,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  // ── Tournaments ──
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('slug, updated_at, year')
    .in('category', ['slam', '1000', '500', '250', 'finals'])
    .order('year', { ascending: false });

  const tournamentPages: MetadataRoute.Sitemap = (tournaments ?? []).map(t => ({
    url: `${BASE}/torneios/${t.slug}`,
    lastModified: t.updated_at ? new Date(t.updated_at) : now,
    changeFrequency: 'monthly',
    priority: 0.55,
  }));

  return [...staticPages, ...playerPages, ...tournamentPages];
}
