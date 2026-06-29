import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import HistoricoPage from '../../historico/page';

export const metadata: Metadata = {
  title: 'Histórico de palpites · Performance auditada',
  description:
    'Histórico completo de palpites resolvidos pelo modelo ELO TudoTênis. Yield, taxa de acerto, P&L. Transparência total — todos os palpites são publicados antes dos jogos começarem.',
  alternates: hreflangAlternatesBR('/historico'),
};

export const revalidate = 3600;

export default function Page() {
  return <HistoricoPage locale="pt-BR" />;
}
