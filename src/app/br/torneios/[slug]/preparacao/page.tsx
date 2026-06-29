import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { hreflangAlternatesBR, surfaceLabel } from '@/lib/i18n';

import PreparacaoPage from '../../../../torneios/[slug]/preparacao/page';
export { generateStaticParams } from '../../../../torneios/[slug]/preparacao/page';

export const revalidate = 3600;

export default function Page(props: { params: Promise<{ slug: string }> }) {
  return <PreparacaoPage params={props.params} locale="pt-BR" />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data: t } = await supabase
    .from('tournaments')
    .select('name,full_name,year,surface')
    .eq('slug', slug)
    .single();
  if (!t) return { title: 'Torneio não encontrado' };
  const surfStr = t.surface ? surfaceLabel('pt-BR', t.surface).toLowerCase() : 'piso';
  return {
    title: `Quem está preparado para ${t.full_name ?? t.name}? · ELO ${surfStr}`,
    description: `Análise ELO pré-torneio para ${t.full_name ?? t.name} ${t.year}. Top contenders por ${surfStr}, specialists ocultos, jogadores vulneráveis.`,
    alternates: hreflangAlternatesBR(`/torneios/${slug}/preparacao`),
  };
}
