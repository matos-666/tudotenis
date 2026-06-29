'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n';

/**
 * Switcher PT/BR. Guarda preferência em cookie `tt-locale` para que o
 * middleware respeite a escolha em visitas futuras.
 *
 * Navega para a versão correspondente da página actual:
 *   /picks    → /br/picks
 *   /br/picks → /picks
 */
export function LocaleSwitcher({ current }: { current: Locale }) {
  const pathname = usePathname();
  const router = useRouter();

  function switchTo(next: Locale) {
    if (next === current) return;

    // Set cookie (1 ano)
    document.cookie = `tt-locale=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;

    // Calcular novo path
    const stripped = pathname.startsWith('/br/')
      ? pathname.slice(3)
      : pathname === '/br'
        ? '/'
        : pathname;
    const target = next === 'pt-BR'
      ? (stripped === '/' ? '/br' : `/br${stripped}`)
      : stripped;

    router.push(target);
  }

  return (
    <select
      aria-label="Idioma"
      value={current}
      onChange={e => switchTo(e.target.value as Locale)}
      className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-2 md:px-3 py-1.5 text-xs md:text-sm cursor-pointer"
    >
      <option value="pt-PT">PT</option>
      <option value="pt-BR">BR</option>
    </select>
  );
}
