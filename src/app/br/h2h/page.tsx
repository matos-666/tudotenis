import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import H2HIndexPage from '../../h2h/page';

export const metadata: Metadata = {
  title: 'H2H · Confrontos diretos · ATP/WTA',
  description:
    'Análise H2H entre 33 jogadores ATP/WTA. Probabilidades por piso, comparação ELO e odds justas. 528 confrontos analisados.',
  alternates: hreflangAlternatesBR('/h2h'),
};

export const revalidate = 3600;

export default function Page() {
  return <H2HIndexPage locale="pt-BR" />;
}
