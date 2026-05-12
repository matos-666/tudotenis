import type { Metadata } from 'next';
import { hreflangAlternates } from '@/lib/i18n';

export { default } from '../../torneios/page';

export const metadata: Metadata = {
  title: 'Calendário de Torneios · ATP, WTA, Slams, Masters 1000, ATP 250',
  description:
    'Calendário completo de torneios ATP/WTA. Resultados, vencedores, finalistas e previsões pelo modelo ELO. Slams, Masters 1000, ATP/WTA 500, ATP/WTA 250 e Challengers.',
  alternates: hreflangAlternates('/torneios'),
};
