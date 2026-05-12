import type { Metadata } from 'next';
import { hreflangAlternates } from '@/lib/i18n';

export { default } from '../../h2h/page';

export const metadata: Metadata = {
  title: 'H2H · Confrontos diretos · ATP/WTA',
  description:
    'Análise H2H entre 33 jogadores ATP/WTA. Probabilidades por piso, comparação ELO e odds justas. 528 confrontos analisados.',
  alternates: hreflangAlternates('/h2h'),
};
