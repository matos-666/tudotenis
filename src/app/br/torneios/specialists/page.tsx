import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';

export { default } from '../../../torneios/specialists/page';

export const metadata: Metadata = {
  title: 'Specialists por piso · ELO saibro, grama, hard · TudoTênis',
  description:
    'Quem joga acima do seu nível em cada piso. Top 15 saibro specialists, grama specialists, hard specialists segundo o nosso modelo ELO próprio.',
  alternates: hreflangAlternatesBR('/torneios/specialists'),
};
