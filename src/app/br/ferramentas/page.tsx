import type { Metadata } from 'next';
import { hreflangAlternates } from '@/lib/i18n';

export { default } from '../../ferramentas/page';

export const metadata: Metadata = {
  title: 'Ferramentas · ELO Predictor, Monte Carlo, Kelly · TudoTênis',
  description:
    'Ferramentas grátis: ELO Predictor (probabilidade entre 2 jogadores), Simulador Monte Carlo (10k simulações), Calculadora Kelly (stake ótima).',
  alternates: hreflangAlternates('/ferramentas'),
};
