import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import PicksPage from '../../picks/page';

export const metadata: Metadata = {
  title: 'Palpites de hoje · ELO + Edge · TudoTênis',
  description:
    'Palpites de tênis publicados pelo modelo ELO TudoTênis. Yield comprovado +27,6% em 439 tips auditados. Saibro, hard, grama. ATP, WTA e Challengers.',
  alternates: hreflangAlternatesBR('/picks'),
};

export const revalidate = 600;

export default function Page() {
  return <PicksPage locale="pt-BR" />;
}
