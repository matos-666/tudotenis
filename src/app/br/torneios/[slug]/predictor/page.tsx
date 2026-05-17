import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { hreflangAlternates } from '@/lib/i18n';

export { default, generateStaticParams } from '../../../../torneios/[slug]/predictor/page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data: t } = await supabase
    .from('tournaments')
    .select('name,full_name,year')
    .eq('slug', slug)
    .single();
  if (!t) return { title: 'Torneio não encontrado' };
  return {
    title: `Predictor ${t.full_name ?? t.name} · Probabilidade de vencer · TudoTênis`,
    description: `Simulação Monte Carlo para ${t.full_name ?? t.name} ${t.year}. Probabilidade de cada top contender vencer o título.`,
    alternates: hreflangAlternates(`/torneios/${slug}/predictor`),
  };
}
