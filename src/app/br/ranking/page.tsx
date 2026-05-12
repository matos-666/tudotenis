import type { Metadata } from 'next';
import { hreflangAlternates } from '@/lib/i18n';

export { default } from '../../ranking/page';

export const metadata: Metadata = {
  title: 'Ranking ELO ATP/WTA · 2.557 jogadores',
  description:
    'Ranking ELO próprio para ATP e WTA. Atualizado diariamente com 59k jogos analisados. Veja o top 10 e os movers da semana.',
  alternates: hreflangAlternates('/ranking'),
};
