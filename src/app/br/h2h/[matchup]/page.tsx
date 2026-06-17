import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';

export { default, generateStaticParams } from '../../../h2h/[matchup]/page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchup: string }>;
}): Promise<Metadata> {
  const { matchup } = await params;
  return {
    title: `H2H · ${matchup.replace(/-vs-/g, ' vs ').replace(/-/g, ' ')} · TudoTênis`,
    description: 'Probabilidade ELO de vitória, comparação por piso e odds justas.',
    alternates: hreflangAlternatesBR(`/h2h/${matchup}`),
  };
}
