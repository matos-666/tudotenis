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

      {/* Overlay (escurece o resto da página) */}
      {open && (
        <button
          onClick={() => setOpen(false)}
          aria-label="Fechar menu"
          className="md:hidden fixed inset-0 bg-black/70 z-[998] cursor-default"
          style={{ backdropFilter: 'blur(2px)' }}
        />
      )}

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegação"
        className={`md:hidden fixed top-0 right-0 bottom-0 w-[85%] max-w-[320px] z-[999] shadow-2xl transition-transform duration-250 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        style={{
          backgroundColor: '#0a0e0f',
          borderLeft: '1px solid #1f2937',
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          <Link href="/" onClick={() => setOpen(false)} aria-label="TudoTénis">
            <Image src="/logo.png" alt="TudoTénis" width={1536} height={1024} className="h-10 w-auto" />
          </Link>
          <button
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="bg-[var(--color-card)] hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)] text-gray-300 w-10 h-10 flex items-center justify-center rounded-lg border border-[var(--color-border)] transition text-xl"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-col gap-1 p-4 text-base">
          {NAV_LINKS.map(link => {
            const active =
              pathname === link.href ||
              (link.href !== '/' && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`py-3 px-3 rounded-lg transition ${
                  active
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-semibold'
                    : 'hover:bg-[var(--color-card)] text-gray-200'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div
          className="absolute bottom-0 left-0 right-0 p-4 border-t border-[var(--color-border)]"
          style={{ backgroundColor: '#0a0e0f' }}
        >
          <p className="text-xs text-gray-500 text-center">
            Modelo ELO próprio · 2.557 jogadores
            <br />
            <span className="text-gray-600">+18 · Joga responsável</span>
          </p>
        </div>
      </div>
    </>
  );
}
