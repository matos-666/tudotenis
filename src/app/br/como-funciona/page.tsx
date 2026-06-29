import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import ComoFuncionaPage from '../../como-funciona/page';

export const metadata: Metadata = {
  title: 'Como funciona o modelo ELO TudoTênis · Metodologia',
  description:
    'Explicação completa do modelo ELO TudoTênis: como calculamos os ratings, como detectamos edge nas odds, K-factor por piso, grades A/B/C dos palpites. Yield comprovado +27,6% em 439 tips.',
  alternates: hreflangAlternatesBR('/como-funciona'),
};

export const revalidate = 86400;

export default function Page() {
  return <ComoFuncionaPage locale="pt-BR" />;
}
