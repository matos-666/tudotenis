import Image from 'next/image';
import Link from 'next/link';
import { MobileMenu } from './MobileMenu';
import { ThemeToggle } from './ThemeToggle';
import { LocaleSwitcher } from './LocaleSwitcher';
import { t, localizedHref, type Locale } from '@/lib/i18n';

export function Header({ locale = 'pt-PT' }: { locale?: Locale }) {
  return (
    <header
      role="banner"
      className="border-b border-[var(--color-border)] sticky top-0 z-50 backdrop-blur bg-[var(--color-surface)]/80"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-6 lg:gap-10 min-w-0">
          <Link
            href={localizedHref(locale, '/')}
            aria-label={`TudoTénis — ${t(locale, 'nav.home')}`}
            className="flex items-center flex-shrink-0 hover:opacity-80 transition"
          >
            <Image
              src="/logo.png"
              alt="TudoTénis"
              width={1536}
              height={1024}
              priority
              className="h-16 md:h-20 w-auto"
            />
          </Link>
          <nav
            role="navigation"
            aria-label="Navegação"
            className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-medium"
          >
            <Link href={localizedHref(locale, '/picks')}      className="hover:text-[var(--color-accent)] transition">{t(locale, 'nav.picks')}</Link>
            <Link href={localizedHref(locale, '/jogadores')}  className="hover:text-[var(--color-accent)] transition">{t(locale, 'nav.players')}</Link>
            <Link href={localizedHref(locale, '/h2h')}        className="hover:text-[var(--color-accent)] transition">{t(locale, 'nav.h2h')}</Link>
            <Link href={localizedHref(locale, '/ferramentas')}className="hover:text-[var(--color-accent)] transition">{t(locale, 'nav.tools')}</Link>
            <Link href={localizedHref(locale, '/ranking')}    className="hover:text-[var(--color-accent)] transition">{t(locale, 'nav.ranking')}</Link>
            <Link href={localizedHref(locale, '/torneios')}   className="hover:text-[var(--color-accent)] transition">{t(locale, 'nav.tournaments')}</Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <ThemeToggle />
          <LocaleSwitcher current={locale} />
          <MobileMenu locale={locale} />
        </div>
      </div>
    </header>
  );
}
