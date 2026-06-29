import Image from 'next/image';
import Link from 'next/link';
import { localizedHref, type Locale } from '@/lib/i18n';
import { StarIcon } from '@/components/icons';

export function Footer({ locale = 'pt-PT' }: { locale?: Locale }) {
  const isBR = locale === 'pt-BR';
  const lh = (href: string) => localizedHref(locale, href);

  return (
    <footer role="contentinfo" className="border-t border-[var(--color-border)] mt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-12 grid md:grid-cols-4 gap-8 text-sm">
        <div>
          <div className="mb-4">
            <Image src="/logo.png" alt="TudoTénis" width={1536} height={1024} className="h-10 w-auto" />
          </div>
          <p className="text-gray-500 text-xs">
            {isBR
              ? 'Modelo ELO + estatísticas avançadas em português. Cobertura ATP, WTA, Challengers e ITF.'
              : 'Modelo ELO + stats avançadas em português. Cobertura ATP, WTA, Challengers e ITF.'}
          </p>
        </div>
        <div>
          <div className="font-semibold mb-3">{isBR ? 'Dados' : 'Dados'}</div>
          <ul className="space-y-2 text-gray-500">
            <li><Link href={lh('/ranking')}   className="hover:text-[var(--color-accent)]">Ranking ELO ATP/WTA</Link></li>
            <li><Link href={lh('/jogadores')} className="hover:text-[var(--color-accent)]">{isBR ? 'Perfis dos jogadores' : 'Perfis de jogadores'}</Link></li>
            <li><Link href={lh('/historico')} className="hover:text-[var(--color-accent)]">{isBR ? 'Histórico de palpites' : 'Histórico de picks'}</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold mb-3">Ferramentas</div>
          <ul className="space-y-2 text-gray-500">
            <li><Link href={lh('/ferramentas/predictor')}    className="hover:text-[var(--color-accent)]">ELO Predictor</Link></li>
            <li><Link href={lh('/ferramentas/monte-carlo')}  className="hover:text-[var(--color-accent)]">Simulador Monte Carlo</Link></li>
            <li><Link href={lh('/ferramentas/kelly')}        className="hover:text-[var(--color-accent)]">Calculadora Kelly</Link></li>
            <li><Link href={lh('/torneios')}                 className="hover:text-[var(--color-accent)]">Calendário 2026</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold mb-3">{isBR ? 'Casas parceiras' : 'Casas parceiras'}</div>
          <ul className="space-y-2 text-gray-500">
            <li>
              <a
                href="https://dashboard.onetwoaffiliates.com/click?campaign_id=796&ref_id=370"
                target="_blank"
                rel="sponsored noopener"
                className="hover:text-[var(--color-accent)]"
              >
                Twin <StarIcon size={12} className="inline-block ml-1 text-[var(--color-accent)] align-baseline" />
              </a>
            </li>
            <li>
              <a
                href="https://dashboard.onetwoaffiliates.com/click?campaign_id=797&ref_id=370"
                target="_blank"
                rel="sponsored noopener"
                className="hover:text-[var(--color-accent)]"
              >
                Leon
              </a>
            </li>
            <li className="pt-2"><Link href={lh('/como-funciona')} className="hover:text-[var(--color-accent)]">Como funciona</Link></li>
            <li className="text-xs pt-2">
              {isBR ? '+18 · Jogue com responsabilidade' : '+18 · Joga responsável'}
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[var(--color-border)] py-4 text-center text-xs text-gray-600 px-4">
        © {new Date().getFullYear()} TudoTénis · Dados ELO próprios · 59k jogos analisados
      </div>
    </footer>
  );
}
