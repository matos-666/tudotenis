'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_LINKS = [
  { href: '/picks', label: 'Picks do dia' },
  { href: '/jogadores', label: 'Jogadores' },
  { href: '/h2h', label: 'H2H' },
  { href: '/ferramentas', label: 'Ferramentas' },
  { href: '/ranking', label: 'Ranking ELO' },
  { href: '/torneios', label: 'Torneios' },
  { href: '/como-funciona', label: 'Como funciona' },
];

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Fecha quando navega
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Fecha com ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Lock body scroll quando aberto
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Hamburger button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        aria-expanded={open}
        className="md:hidden bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-2 hover:border-[var(--color-accent)]/40 transition"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Overlay */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 bg-black/60 z-[99] transition-opacity duration-200 md:hidden ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegação"
        className={`fixed top-0 right-0 bottom-0 w-[85%] max-w-[320px] bg-[var(--color-surface)] border-l border-[var(--color-border)] z-[100] shadow-2xl transition-transform duration-250 ease-out md:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <Link href="/" onClick={() => setOpen(false)} aria-label="TudoTénis">
            <Image src="/logo.png" alt="TudoTénis" width={140} height={28} className="h-7 w-auto" />
          </Link>
          <button
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="text-gray-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--color-card)]"
          >
            ×
          </button>
        </div>

        <nav className="flex flex-col gap-1 p-4 text-base">
          {NAV_LINKS.map(link => {
            const active = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`py-3 px-3 rounded-lg transition ${
                  active
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-semibold'
                    : 'hover:bg-[var(--color-card)]'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
          <p className="text-xs text-gray-500 text-center">
            Modelo ELO próprio · 1.059 jogadores
            <br />
            <span className="text-gray-600">+18 · Joga responsável</span>
          </p>
        </div>
      </div>
    </>
  );
}
