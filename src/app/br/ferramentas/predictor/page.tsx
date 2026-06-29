import type { Metadata } from 'next';
import { hreflangAlternatesBR } from '@/lib/i18n';
import PredictorPage from '../../../ferramentas/predictor/page';

export const metadata: Metadata = {
  title: 'ELO Predictor · Probabilidade entre 2 jogadores',
  description:
    'Calcula a probabilidade de vitória entre quaisquer 2 jogadores ATP/WTA usando o modelo ELO. 4 pisos · BO3/BO5 · odd justa · edge vs casa · distribuição Monte Carlo.',
  alternates: hreflangAlternatesBR('/ferramentas/predictor'),
};

export const revalidate = 86400;

export default function Page() {
  return <PredictorPage locale="pt-BR" />;
}
