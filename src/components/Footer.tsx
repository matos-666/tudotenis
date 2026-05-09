import Image from 'next/image';
import Link from 'next/link';

export function Footer() {
  return (
    <footer role="contentinfo" className="border-t border-[var(--color-border)] mt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-12 grid md:grid-cols-4 gap-8 text-sm">
        <div>
          <div className="mb-4">
            <Image src="/logo.png" alt="TudoTénis" width={1536} height={1024} className="h-10 w-auto" />
          </div>
          <p className="text-gray-500 text-xs">
            Modelo ELO + stats avançadas em português. Cobertura ATP, WTA, Challengers e ITF.
          </p>
        </div>
        <div>
          <div className="font-semibold mb-3">Dados</div>
          <ul className="space-y-2 text-gray-500">
            <li><Link href="/ranking" className="hover:text-[var(--color-accent)]">Ranking ELO ATP/WTA</Link></li>
            <li><Link href="/jogadores" className="hover:text-[var(--color-accent)]">Perfis de jogadores</Link></li>
            <li><Link href="/h2h" className="hover:text-[var(--color-accent)]">H2H · 30k+ páginas</Link></li>
            <li><Link href="/historico" className="hover:text-[var(--color-accent)]">Histórico de picks</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold mb-3">Ferramentas</div>
          <ul className="space-y-2 text-gray-500">
            <li><Link href="/ferramentas/predictor" className="hover:text-[var(--color-accent)]">ELO Predictor</Link></li>
            <li><Link href="/ferramentas/monte-carlo" className="hover:text-[var(--color-accent)]">Simulador Monte Carlo</Link></li>
            <li><Link href="/ferramentas/kelly" className="hover:text-[var(--color-accent)]">Calculadora Kelly</Link></li>
            <li><Link href="/torneios" className="hover:text-[var(--color-accent)]">Calendário 2026</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold mb-3">Casas parceiras</div>
          <ul className="space-y-2 text-gray-500">
            <li>
              <a
                href="https://dashboard.onetwoaffiliates.com/click?campaign_id=796&ref_id=370"
                target="_blank"
                rel="sponsored noopener"
                className="hover:text-[var(--color-accent)]"
              >
                Twin <span className="text-xs">⭐</span>
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
            <li className="pt-2"><Link href="/como-funciona" className="hover:text-[var(--color-accent)]">Como funciona</Link></li>
            <li className="text-xs pt-2">+18 · Joga responsável</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[var(--color-border)] py-4 text-center text-xs text-gray-600 px-4">
        © {new Date().getFullYear()} TudoTénis · Dados ELO próprios · 59k jogos analisados
      </div>
    </footer>
  );
}
