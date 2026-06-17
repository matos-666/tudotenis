import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { hreflangAlternatesBR } from '@/lib/i18n';

export { default, generateStaticParams } from '../../../torneios/[slug]/page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data: t } = await supabase
    .from('tournaments')
    .select('name, full_name, surface_label, slug')
    .eq('slug', slug)
    .single();
  if (!t) return { title: 'Torneio não encontrado' };
  return {
    title: `${t.full_name ?? t.name} · ${t.surface_label ?? ''} · TudoTênis`,
    description: `${t.full_name ?? t.name} · resultados, ELO e previsões.`,
    alternates: hreflangAlternatesBR(`/torneios/${t.slug}`),
  };
}
