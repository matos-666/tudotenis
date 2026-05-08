import Image from 'next/image';
import Link from 'next/link';

export function Header() {
  return (
    <header
      role="banner"
      className="border-b border-[var(--color-border)] sticky top-0 z-50 backdrop-blur bg-[var(--color-surface)]/80"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-6 lg:gap-10 min-w-0">
          <Link
            href="/"
            aria-label="TudoTénis — Página inicial"
            className="flex items-center flex-shrink-0 hover:opacity-80 transition"
          >
            <Image
              src="/logo.png"
              alt="TudoTénis"
              width={260}
              height={56}
              priority
              className="h-10 md:h-12 w-auto"
            />
          </Link>
          <nav
            role="navigation"
            aria-label="Navegação principal"
            className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-medium"
          >
            <Link href="/" className="hover:text-[var(--color-accent)] transition">Picks do dia</Link>
            <Link href="/jogadores" className="hover:text-[var(--color-accent)] transition">Jogadores</Link>
            <Link href="/h2h" className="hover:text-[var(--color-accent)] transition">H2H</Link>
            <Link href="/ferramentas" className="hover:text-[var(--color-accent)] transition">Ferramentas</Link>
            <Link href="/ranking" className="hover:text-[var(--color-accent)] transition">Ranking ELO</Link>
            <Link href="/torneios" className="hover:text-[var(--color-accent)] transition">Torneios</Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <select
            aria-label="Idioma"
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-2 md:px-3 py-1.5 text-xs md:text-sm cursor-pointer"
          >
            <option value="pt-BR">🇧🇷</option>
            <option value="pt-PT">🇵🇹</option>
          </select>
          <button
            aria-label="Menu"
            className="md:hidden bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-2"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
