import type { Metadata } from 'next';
import { HomePage } from '@/components/HomePage';

export const metadata: Metadata = {
  title: 'TudoTênis · Palpites ELO + Stats',
  description:
    'Modelo ELO próprio com 59k jogos analisados de tênis ATP, WTA, Challengers e ITF. Yield +27,6% em 439 tips auditados. Em português.',
  alternates: {
    canonical: '/br',
    languages: {
      'pt-PT': 'https://tudotenis.com/',
      'pt-BR': 'https://tudotenis.com/br',
      'x-default': 'https://tudotenis.com/',
    },
  },
};

export default function BrPage() {
  return <HomePage locale="pt-BR" />;
}
