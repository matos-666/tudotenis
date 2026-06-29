import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import FerramentasIndex from '../../ferramentas/page';

export const metadata: Metadata = {
  title: 'Ferramentas · ELO Predictor, Monte Carlo, Kelly',
  description:
    'Ferramentas grátis: ELO Predictor (probabilidade entre 2 jogadores), Simulador Monte Carlo (10k simulações), Calculadora Kelly (stake ótima).',
  alternates: hreflangAlternatesBR('/ferramentas'),
};

export const revalidate = 86400;

export default function Page() {
  return <FerramentasIndex locale="pt-BR" />;
}
