import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import AoVivoPage from '../../ao-vivo/page';

export const metadata: Metadata = {
  title: 'Ao vivo · Partidas em andamento',
  description:
    'Lista de partidas de tênis em andamento agora, com nossa probabilidade ELO e placar atualizado a cada 20 segundos.',
  alternates: hreflangAlternatesBR('/ao-vivo'),
};

// ISR curto (10s) — ver nota em /ao-vivo. force-dynamic esgotou o free
// tier do Vercel; o edge cache serve a maioria dos requests sem invocar.
export const revalidate = 10;

export default function Page() {
  return <AoVivoPage locale="pt-BR" />;
}
