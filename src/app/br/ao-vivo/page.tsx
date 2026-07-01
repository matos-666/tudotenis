import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import AoVivoPage from '../../ao-vivo/page';

export const metadata: Metadata = {
  title: 'Ao vivo · Partidas em andamento',
  description:
    'Lista de partidas de tênis em andamento agora, com nossa probabilidade ELO e placar atualizado a cada 20 segundos.',
  alternates: hreflangAlternatesBR('/ao-vivo'),
};

export const revalidate = 20;

export default function Page() {
  return <AoVivoPage locale="pt-BR" />;
}
