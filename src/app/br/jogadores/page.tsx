import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';

export { default } from '../../jogadores/page';

export const metadata: Metadata = {
  title: 'Jogadores · ATP, WTA, Challengers · TudoTênis',
  description:
    'Diretório completo de jogadores de tênis. ELO próprio, head-to-head, estatísticas por piso. ATP, WTA, Challengers e ITF — em português.',
  alternates: hreflangAlternatesBR('/jogadores'),
};
