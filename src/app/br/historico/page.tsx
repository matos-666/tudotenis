import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';

export { default } from '../../historico/page';

export const metadata: Metadata = {
  title: 'Histórico de palpites · Performance auditada · TudoTênis',
  description:
    'Histórico completo de palpites resolvidos pelo modelo ELO TudoTênis. Yield, taxa de acerto, P&L. Transparência total — todos os palpites são publicados antes dos jogos começarem.',
  alternates: hreflangAlternatesBR('/historico'),
};
