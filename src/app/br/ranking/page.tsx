import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import RankingPage from '../../ranking/page';

export const metadata: Metadata = {
  title: 'Ranking ELO ATP/WTA · 2.557 jogadores',
  description:
    'Ranking ELO próprio para ATP e WTA. Atualizado diariamente com 59k jogos analisados. Veja o top 10 e os movers da semana.',
  alternates: hreflangAlternatesBR('/ranking'),
};

export const revalidate = 3600;

export default function Page() {
  return <RankingPage locale="pt-BR" />;
}
