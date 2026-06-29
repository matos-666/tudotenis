import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';

import H2HPage from '../../../h2h/[matchup]/page';
export { generateStaticParams } from '../../../h2h/[matchup]/page';

export const revalidate = 3600;

export default function Page(props: { params: Promise<{ matchup: string }> }) {
  return <H2HPage params={props.params} locale="pt-BR" />;
}

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
