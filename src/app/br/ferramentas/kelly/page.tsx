import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';

export { default } from '../../../ferramentas/kelly/page';

export const metadata: Metadata = {
  title: 'Calculadora Kelly · Stake ótima por bankroll · TudoTênis',
  description:
    'Calcula o stake ideal para cada aposta usando o critério de Kelly. Bankroll, odd da casa, probabilidade do modelo, fração Kelly (cauteloso → agressivo).',
  alternates: hreflangAlternatesBR('/ferramentas/kelly'),
};
