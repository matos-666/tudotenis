import type { Metadata } from 'next';
import { hreflangAlternates } from '@/lib/i18n';

export { default } from '../../picks/page';

export const metadata: Metadata = {
  title: 'Palpites de hoje · ELO + Edge · TudoTênis',
  description:
    'Palpites de tênis publicados pelo modelo ELO TudoTênis. Yield comprovado +27,6% em 439 tips auditados. Saibro, hard, grama. ATP, WTA e Challengers.',
  alternates: hreflangAlternates('/picks'),
};
