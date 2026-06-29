'use client';

/**
 * Coverflow-style 3D carousel para matches ao vivo.
 *
 * - Auto-rotate cada 4.5s
 * - Pausa no hover (desktop) e no touch sustained (mobile)
 * - Card activo: full scale, glow vermelho pulsante, P% destacada
 * - Cards laterais: rotacionados em Y, scale menor, opacidade reduzida
 * - Cards distantes: invisíveis (mas no DOM para SEO/a11y)
 * - Indicadores: dots clicáveis + barra de progresso até próximo slide
 * - Click em qualquer card → /jogo/[matchId]
 */
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { localizedHref, type Locale } from '@/lib/i18n';

export interface LiveMatchCard {
  sr_match_id: number;
  name_a: string | null;
  name_b: string | null;
  set_a: number;
  set_b: number;
  game_a: number;
  game_b: number;
  tiebreak: boolean;
  match_win_prob_a: number | null;
  tournament_slug: string | null;
}

interface Props {
  matches: LiveMatchCard[];
  locale: Locale;
  ctaLabel: string;
}

const ROTATE_MS = 4500;

export function LiveMatchesCarousel({ matches, locale, ctaLabel }: Props) {
  const href = (p: string) => localizedHref(locale, p);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const len = matches.length;

  // Auto-rotate with progress bar
  useEffect(() => {
    if (paused || len <= 1) {
      setProgress(0);
      return;
    }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const p = Math.min(1, elapsed / ROTATE_MS);
      setProgress(p);
      if (p >= 1) {
        setActive(a => (a + 1) % len);
        startRef.current = now;
        setProgress(0);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [paused, len, active]);

  if (len === 0) return null;

  function cardTransform(offset: number): { style: React.CSSProperties; visible: boolean } {
    const abs = Math.abs(offset);
    // Wrap offset to nearest representation (so carousel loops smoothly)
    let off = offset;
    if (offset > len / 2) off = offset - len;
    if (offset < -len / 2) off = offset + len;
    const absOff = Math.abs(off);

    if (absOff > 2) {
      return {
        style: { opacity: 0, pointerEvents: 'none', transform: 'translateX(-50%) scale(0.5)' },
        visible: false,
      };
    }

    const direction = off > 0 ? 1 : -1;
    const translatePct = off === 0 ? -50 : -50 + direction * (absOff === 1 ? 70 : 130);
    const rotateY = off === 0 ? 0 : -direction * (absOff === 1 ? 32 : 52);
    const translateZ = off === 0 ? 0 : -110 * absOff;
    const scale = off === 0 ? 1 : absOff === 1 ? 0.82 : 0.62;
    const opacity = off === 0 ? 1 : absOff === 1 ? 0.55 : 0.18;
    const zIndex = 10 - absOff;

    return {
      style: {
        transform: `translateX(${translatePct}%) translateZ(${translateZ}px) scale(${scale}) rotateY(${rotateY}deg)`,
        opacity,
        zIndex,
      },
      visible: true,
    };
  }

  return (
    <div
      className="relative select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setTimeout(() => setPaused(false), 3000)}
    >
      {/* Carousel arena */}
      <div
        className="relative mx-auto"
        style={{
          height: '210px',
          perspective: '1400px',
          transformStyle: 'preserve-3d',
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          {matches.map((m, i) => {
            const offset = i - active;
            const { style, visible } = cardTransform(offset);
            const probA = m.match_win_prob_a;
            const aFav = probA != null && probA >= 0.5;
            const lastA = (m.name_a ?? '').split(',')[0] || '?';
            const lastB = (m.name_b ?? '').split(',')[0] || '?';
            const isActive = offset === 0 || offset === len; // wrap

            return (
              <Link
                key={m.sr_match_id}
                href={href(`/jogo/${m.sr_match_id}`)}
                aria-hidden={!visible}
                tabIndex={visible ? 0 : -1}
                className="absolute left-1/2 top-1/2 w-[300px] md:w-[340px] -translate-y-1/2 cursor-pointer transition-all duration-700 ease-out"
                style={style}
              >
                <div
                  className={`relative stat-card p-4 md:p-5 transition-all duration-500 ${
                    isActive
                      ? 'border-red-500/60 shadow-[0_0_40px_rgba(239,68,68,0.25)]'
                      : 'border-[var(--color-border)]'
                  }`}
                  style={{
                    background: isActive
                      ? 'linear-gradient(135deg, var(--color-card) 0%, rgba(239,68,68,0.04) 100%)'
                      : 'var(--color-card)',
                  }}
                >
                  {/* Live badge */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="inline-flex items-center gap-1.5 text-red-400 text-[10px] font-bold uppercase tracking-wider">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                      </span>
                      AO VIVO
                    </span>
                    <span className="text-[10px] text-gray-500 truncate max-w-[140px]">
                      {m.tournament_slug?.replace(/-/g, ' ')}
                    </span>
                  </div>

                  {/* Players + score */}
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center mb-3">
                    <div className={`text-base md:text-lg truncate ${aFav ? 'font-extrabold text-[var(--color-accent)]' : 'font-semibold text-gray-300'}`}>
                      {lastA}
                    </div>
                    <div className="text-center font-mono px-1">
                      <div className="text-2xl md:text-3xl font-extrabold tracking-wider">{m.set_a}-{m.set_b}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{m.tiebreak ? 'TIEBREAK' : `${m.game_a}-${m.game_b}`}</div>
                    </div>
                    <div className={`text-base md:text-lg truncate text-right ${probA != null && !aFav ? 'font-extrabold text-[var(--color-accent)]' : 'font-semibold text-gray-300'}`}>
                      {lastB}
                    </div>
                  </div>

                  {/* Probability bar */}
                  {probA != null && (
                    <div>
                      <div
                        className="relative h-2 rounded-full overflow-hidden bg-[var(--color-surface)]"
                      >
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent)]/80 transition-all duration-700"
                          style={{ width: `${probA * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] mt-1.5 font-mono text-gray-400">
                        <span>{Math.round(probA * 100)}%</span>
                        <span className="text-[var(--color-accent)] text-[11px] font-semibold">{ctaLabel}</span>
                        <span>{Math.round((1 - probA) * 100)}%</span>
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Indicator dots + progress bar */}
      {len > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {matches.map((m, i) => (
            <button
              key={`dot-${m.sr_match_id}`}
              onClick={() => {
                setActive(i);
                startRef.current = performance.now();
                setProgress(0);
              }}
              aria-label={`Match ${i + 1} de ${len}`}
              className="group p-1"
            >
              <span
                className={`block h-1 rounded-full transition-all duration-500 ${
                  i === active ? 'bg-red-400 w-8' : 'bg-gray-500/40 w-2 group-hover:bg-gray-400/60'
                }`}
              >
                {i === active && !paused && (
                  <span
                    className="block h-full bg-red-300/60 rounded-full"
                    style={{ width: `${progress * 100}%`, transition: 'none' }}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
