'use client';

/**
 * OddsCompareCTA — botão único nos matchcards de /picks.
 *
 * Substitui os dois botões Twin + Leon por um único CTA que visualmente
 * faz rotação rápida (≈1.5s) por uma lista de casas de apostas
 * conhecidas (Betano, Bet365, etc.) — sugere ao user que estamos a
 * comparar o mercado em tempo real. No fim da animação, settla em
 * Twin ou Leon (deterministicamente por seed, 70/30 a favor da Twin
 * porque é a nossa primary) e o clique redireciona para o tracking
 * URL real do affiliate.
 *
 * Inspiração: webpronos.com/go/bet?match_id=…&market=…&odd=… — UX que
 * mostra "shopping around" antes do redirect afiliado.
 *
 * Acessibilidade:
 *   - prefers-reduced-motion → skip animation, settled state direto
 *   - aria-live="off" no nome a rodar (não interrompe screen readers)
 *   - aria-label fixo descreve o destino real
 */
import { useEffect, useState } from 'react';
import { AFFILIATES } from '@/lib/affiliates';

const SHOWCASE_BOOKIES = [
  'Betano',
  'Betclic',
  'Betway',
  '22Bet',
  'Bet365',
  'William Hill',
  'Pinnacle',
  'LeBull',
];

const TICK_MS = 200;
const TICKS = 7; // ~1.4s total

interface Props {
  /** Seed estável (geralmente pick id) — garante mesmo destino entre renders */
  seed?: number | string;
  isBR?: boolean;
}

export function OddsCompareCTA({ seed = 0, isBR = false }: Props) {
  // Deterministic Twin/Leon: 70/30 favor a Twin (primary)
  const seedNum =
    typeof seed === 'number'
      ? seed
      : Array.from(String(seed)).reduce((s, c) => s + c.charCodeAt(0), 0);
  const winner = seedNum % 10 < 7 ? AFFILIATES[0] : AFFILIATES[1];

  const [idx, setIdx] = useState(seedNum % SHOWCASE_BOOKIES.length);
  // Lazy init: utilizadores com prefers-reduced-motion já começam settled
  // (skip da animação inteira). Evita setState dentro do effect.
  const [done, setDone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (done) return; // reduced-motion → nada para animar
    let n = 0;
    const id = window.setInterval(() => {
      n++;
      if (n >= TICKS) {
        window.clearInterval(id);
        setDone(true);
      } else {
        setIdx(i => (i + 1) % SHOWCASE_BOOKIES.length);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [done]);

  const label = isBR
    ? `Apostar em ${winner.name} (melhor odd)`
    : `Apostar na ${winner.name} (melhor odd)`;

  return (
    <a
      href={winner.trackingUrl}
      target="_blank"
      rel="sponsored noopener"
      aria-label={label}
      className="block w-full bg-[var(--color-accent)] text-[var(--color-surface)] hover:opacity-95 active:opacity-90 transition px-4 py-3 rounded-lg font-semibold text-sm md:text-base relative overflow-hidden"
    >
      {done ? (
        <span className="flex items-center justify-center gap-2 whitespace-nowrap">
          <span aria-hidden>🏆</span>
          <span>{isBR ? 'Melhor odd' : 'Melhor odd'} @</span>
          <span className="font-extrabold">{winner.name}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <path d="M7 17L17 7M17 7H7M17 7V17" />
          </svg>
        </span>
      ) : (
        <span className="flex items-center justify-center gap-2 whitespace-nowrap">
          <span aria-hidden className="opacity-80">🔍</span>
          <span className="opacity-85">
            {isBR ? 'Comparando' : 'A comparar'}
          </span>
          <span
            className="font-extrabold inline-block min-w-[78px] text-left tabular-nums"
            aria-live="off"
          >
            {SHOWCASE_BOOKIES[idx]}…
          </span>
        </span>
      )}
    </a>
  );
}
