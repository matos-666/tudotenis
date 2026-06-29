import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import SpecialistsPage from '../../../torneios/specialists/page';

export const metadata: Metadata = {
  title: 'Specialists por piso · ELO saibro, grama, hard',
  description:
    'Quem joga acima do seu nível em cada piso. Top 15 saibro specialists, grama specialists, hard specialists segundo o nosso modelo ELO próprio.',
  alternates: hreflangAlternatesBR('/torneios/specialists'),
};

export const revalidate = 3600;

export default function Page() {
  return <SpecialistsPage locale="pt-BR" />;
}
