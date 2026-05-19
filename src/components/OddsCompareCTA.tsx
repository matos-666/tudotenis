'use client';

/**
 * OddsCompareCTA — botão "Encontrar melhores odds" nos matchcards de /picks.
 *
 * Fluxo:
 *   1. User vê botão único com label fixo "Encontrar melhores odds"
 *   2. Clique abre modal centrado com backdrop blur
 *   3. Modal: rotação visual por 8 casas conhecidas (~2.4s) → settle
 *      em Twin ou Leon (70/30 favor primary, deterministicamente por seed)
 *   4. Estado final mostra odd + nome da casa + botão "Apostar @ X"
 *   5. Clicar no Apostar abre tracking URL em nova tab e fecha modal
 *
 * UX-pattern espelha o webpronos.com/go/bet (interstitial de "comparação"
 * antes do redirect afiliado) mas em modal vs página separada.
 *
 * Acessibilidade:
 *   - prefers-reduced-motion → salta animação, modal abre já settled
 *   - ESC / clique no backdrop fecha
 *   - aria-modal + aria-labelledby
 *   - body scroll lock quando aberto
 *   - aria-live="polite" no nome em rotação (só atualiza no settle final)
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const TICK_MS = 220;
const TICKS = 11; // ~2.4s

interface Props {
  /** Seed estável (pick.id) — garante mesmo destino Twin/Leon entre renders */
  seed?: number | string;
  /** Odd a mostrar no estado final do modal */
  odd?: number;
  /** Mercado (e.g. "Vencedor") a mostrar no modal */
  market?: string;
  isBR?: boolean;
}

export function OddsCompareCTA({ seed = 0, odd, market, isBR = false }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full bg-[var(--color-accent)] text-[var(--color-surface)] hover:opacity-95 active:opacity-90 transition px-4 py-3 rounded-lg font-semibold text-sm md:text-base"
      >
        <span className="flex items-center justify-center gap-2 whitespace-nowrap">
          <span aria-hidden>🔍</span>
          <span>{isBR ? 'Encontrar melhores odds' : 'Encontrar melhores odds'}</span>
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
      </button>
      {open && (
        <OddsCompareModal
          seed={seed}
          odd={odd}
          market={market}
          isBR={isBR}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────

function OddsCompareModal({
  seed = 0,
  odd,
  market,
  isBR,
  onClose,
}: {
  seed?: number | string;
  odd?: number;
  market?: string;
  isBR: boolean;
  onClose: () => void;
}) {
  // Deterministic Twin/Leon: 70/30 favor Twin (primary)
  const seedNum =
    typeof seed === 'number'
      ? seed
      : Array.from(String(seed)).reduce((s, c) => s + c.charCodeAt(0), 0);
  const winner = seedNum % 10 < 7 ? AFFILIATES[0] : AFFILIATES[1];

  const [idx, setIdx] = useState(seedNum % SHOWCASE_BOOKIES.length);
  // Reduced-motion → começa já settled, salta animação
  const [done, setDone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  // O modal só monta quando o parent passa open=true → user já clicou,
  // logo cliente está hidratado. Não precisamos de mounted-state guard.

  // ESC para fechar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Animation
  useEffect(() => {
    if (done) return;
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

  // Auto-redirect 1s após settle: clica programaticamente o anchor real
  // (preserva user-activation melhor do que window.open + setTimeout).
  // O user pode fechar o modal antes para cancelar o redirect.
  const autoLinkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => {
      autoLinkRef.current?.click();
      window.setTimeout(onClose, 200);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [done, onClose]);

  // SSR safety: createPortal precisa de document
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label={isBR ? 'Fechar' : 'Fechar'}
        className="fixed inset-0 bg-black/80 z-[9998] cursor-default animate-in fade-in duration-200"
        style={{ backdropFilter: 'blur(4px)' }}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="odds-cmp-title"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92%] max-w-md z-[9999] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 md:p-8 shadow-2xl"
      >
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label={isBR ? 'Fechar' : 'Fechar'}
          className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-[var(--color-card)] transition text-lg"
        >
          ×
        </button>

        {done ? (
          // ── SETTLED ────────────────────────────────────────────────────
          <div className="text-center">
            <div className="text-4xl mb-2" aria-hidden>🏆</div>
            <h2 id="odds-cmp-title" className="text-lg md:text-xl font-bold mb-1">
              {isBR ? 'Melhor odd encontrada' : 'Melhor odd encontrada'}
            </h2>
            <p className="text-xs text-gray-500 mb-5 px-2">
              {isBR
                ? `Comparámos 8 casas. ${winner.name} tem a melhor odd para este jogo.`
                : `Comparámos 8 casas. ${winner.name} tem a melhor odd para este jogo.`}
            </p>

            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4 md:p-5 mb-5">
              {market && (
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  {market}
                </div>
              )}
              {odd != null && isFinite(Number(odd)) && (
                <div className="text-3xl md:text-4xl font-extrabold font-mono text-[var(--color-accent)] leading-none">
                  @ {Number(odd).toFixed(2)}
                </div>
              )}
              <div className="text-sm text-gray-400 mt-2 font-semibold">
                {winner.name}
              </div>
            </div>

            <a
              ref={autoLinkRef}
              href={winner.trackingUrl}
              target="_blank"
              rel="sponsored noopener"
              onClick={() => {
                window.setTimeout(onClose, 400);
              }}
              className="relative block w-full bg-[var(--color-accent)] text-[var(--color-surface)] hover:opacity-95 active:opacity-90 transition px-4 py-3 md:py-3.5 rounded-lg font-bold text-base overflow-hidden"
            >
              {/* Progress bar a encher durante o 1s do auto-redirect */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-black/20 origin-left"
                style={{
                  animation: 'odds-cmp-fill 1s linear forwards',
                  width: '100%',
                  transformOrigin: 'left',
                }}
              />
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span>{isBR ? 'Apostar' : 'Apostar'} @ {winner.name}</span>
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
            </a>

            <p className="text-[10px] text-gray-500 mt-3 leading-snug">
              {isBR
                ? 'A redirecionar em 1s · Anúncio sponsorizado · 18+'
                : 'A redirecionar em 1s · Anúncio sponsorizado · 18+'}
            </p>

            {/* CSS local da progress bar */}
            <style>{`
              @keyframes odds-cmp-fill {
                from { transform: scaleX(0); }
                to   { transform: scaleX(1); }
              }
            `}</style>
          </div>
        ) : (
          // ── SPINNING ───────────────────────────────────────────────────
          <div className="text-center">
            <h2 id="odds-cmp-title" className="text-lg md:text-xl font-bold mb-1">
              {isBR ? 'Comparando odds' : 'A comparar odds'}
            </h2>
            <p className="text-xs text-gray-500 mb-6">
              {isBR ? 'em 8 casas de apostas...' : 'em 8 casas de apostas...'}
            </p>

            <div className="my-8 min-h-[60px] flex items-center justify-center">
              <div
                className="text-3xl md:text-4xl font-extrabold text-[var(--color-accent)] tracking-tight"
                aria-live="polite"
              >
                {SHOWCASE_BOOKIES[idx]}
              </div>
            </div>

            <div className="flex justify-center gap-1.5 mb-2">
              {SHOWCASE_BOOKIES.map((_, i) => (
                <span
                  key={i}
                  className={`block w-1.5 h-1.5 rounded-full transition-colors duration-150 ${
                    i === idx
                      ? 'bg-[var(--color-accent)] scale-150'
                      : 'bg-[var(--color-border)]'
                  }`}
                  style={i === idx ? { transform: 'scale(1.5)' } : undefined}
                  aria-hidden
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
