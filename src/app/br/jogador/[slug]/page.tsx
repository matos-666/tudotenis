import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { hreflangAlternatesBR } from '@/lib/i18n';

import PlayerPage from '../../../jogador/[slug]/page';
export { generateStaticParams } from '../../../jogador/[slug]/page';

export const revalidate = 3600;

export default function Page(props: { params: Promise<{ slug: string }> }) {
  return <PlayerPage params={props.params} locale="pt-BR" />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data: p } = await supabase
    .from('players')
    .select('name, tour, atp_rank, elo_overall, elo_hard, elo_clay, elo_grass, photo_url, slug')
    .eq('slug', slug)
    .single();
  if (!p) return { title: 'Jogador não encontrado' };
  return {
    title: `${p.name} · ELO ${p.elo_overall} · Stats e Perfil`,
    description: `Perfil de ${p.name} (${(p.tour as string).toUpperCase()} #${p.atp_rank ?? '?'}). ELO próprio: ${p.elo_overall} geral · ${p.elo_hard} hard · ${p.elo_clay} saibro · ${p.elo_grass} grama. Histórico, splits por piso, próximos jogos.`, // pt-BR keeps saibro/grama
    alternates: hreflangAlternatesBR(`/jogador/${p.slug}`),
    openGraph: {
      title: `${p.name}`,
      description: `ELO ${p.elo_overall} · ${(p.tour as string).toUpperCase()} #${p.atp_rank ?? '?'}`,
      images: p.photo_url ? [{ url: p.photo_url as string, alt: p.name as string }] : undefined,
    },
  };
}
