import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import AoVivoPage from '../../ao-vivo/page';

export const metadata: Metadata = {
  title: 'Ao vivo · Partidas em andamento',
  description:
    'Lista de partidas de tênis em andamento agora, com nossa probabilidade ELO e placar atualizado a cada 20 segundos.',
  alternates: hreflangAlternatesBR('/ao-vivo'),
};

// Página live: sem cache de edge. Com ISR (mesmo revalidate=5), o Vercel
// serve stale-while-revalidate — a primeira visita após um período sem
// tráfego recebia a versão cacheada de quando não havia jogos (age de
// minutos/horas) e só a visita seguinte via os matches. force-dynamic
// garante render fresco em cada request; AutoRefresh mantém a 12s.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <AoVivoPage locale="pt-BR" />;
}
