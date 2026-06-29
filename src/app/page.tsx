import type { Metadata } from 'next';
import { HomePage } from '@/components/HomePage';

export const metadata: Metadata = {
  title: 'TudoTénis · Picks ELO + Stats',
  description:
    'Modelo ELO próprio com 59k jogos analisados de ténis ATP, WTA, Challengers e ITF. Yield +27,6% em 439 tips auditadas. Em português.',
  alternates: {
    canonical: '/',
    languages: {
      'pt-PT': 'https://tudotenis.com/',
      'pt-BR': 'https://tudotenis.com/br',
      'x-default': 'https://tudotenis.com/',
    },
  },
};

export const revalidate = 60;

export default function Page() {
  return <HomePage locale="pt-PT" />;
}
