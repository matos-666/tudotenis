/**
 * Branded icon set para TudoTénis.
 *
 * Linguagem visual:
 *   - viewBox 24×24
 *   - strokeWidth 1.5 (mais leve que padrão Heroicons/Lucide → sensação premium)
 *   - currentColor para adaptar a qualquer cor herdada
 *   - rounded line caps/joins
 *   - geometric, ligado ao universo do ténis (raquetes, court, ball)
 *
 * Convenção de uso:
 *   <Icon className="text-[var(--color-accent)]" size={20} />
 *
 * Para destacar um elemento brand: passar prop `accent` (segundo path
 * herda var(--color-accent) directo, ignorando currentColor).
 */
import type { SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number | string;
}

function Base({ size = 20, className, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

// ── Tennis ball — 3/4 view com seam curve ───────────────────────────────
export function TennisBallIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 8.5C6.5 9.5 8.5 11.5 8.5 14.5C8.5 17 7 19 5 20.5" />
      <path d="M20.5 8.5C17.5 9.5 15.5 11.5 15.5 14.5C15.5 17 17 19 19 20.5" />
    </Base>
  );
}

// ── Trophy — cup hexagonal com handles abertos ─────────────────────────
export function TrophyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 4h8v6a4 4 0 01-8 0V4z" />
      <path d="M8 6H5a2 2 0 002 4h1M16 6h3a2 2 0 01-2 4h-1" />
      <path d="M12 14v3M9 21h6M10 17h4l-1 4h-2l-1-4z" />
    </Base>
  );
}

// ── Coins — duas moedas sobrepostas com sinal $ ────────────────────────
export function CoinsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9" cy="9" r="6" />
      <circle cx="15.5" cy="15.5" r="5.5" />
      <path d="M15.5 13v5M14 14.5h2a1 1 0 010 2h-2a1 1 0 000 2h2.5" />
    </Base>
  );
}

// ── Crossed racquets — duas hastes a X com ball central ────────────────
export function CrossedRacquetsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="6" cy="6" r="3" />
      <path d="M8.5 8.5L14 14" />
      <circle cx="18" cy="6" rx="3" ry="3" />
      <path d="M15.5 8.5L10 14" />
      <circle cx="12" cy="18" r="2.2" fill="currentColor" stroke="none" />
    </Base>
  );
}

// ── Target — 3 anéis concentric + crosshair ────────────────────────────
export function TargetIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2" />
    </Base>
  );
}

// ── Star — solid 5-point ───────────────────────────────────────────────
export function StarIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path
        d="M12 2.5l2.6 5.7 6.2.6-4.7 4.2 1.4 6.1L12 16l-5.5 3.1 1.4-6.1L3.2 8.8l6.2-.6L12 2.5z"
        fill="currentColor"
      />
    </Base>
  );
}

// ── Alert triangle ─────────────────────────────────────────────────────
export function AlertTriangleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3.5L2.5 20.5h19L12 3.5z" />
      <path d="M12 10v5" />
      <circle cx="12" cy="17.8" r="0.5" fill="currentColor" stroke="none" />
    </Base>
  );
}

// ── Bar chart — 3 barras ascending + baseline ──────────────────────────
export function ChartIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 20V13M11 20V8M17 20V4M3 20.5h18" />
    </Base>
  );
}

// ── Court — mini tennis court layout, pode ser usado em live/scoreboard ─
export function CourtIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M3 12h18M12 5v14M7 8.5h10v7H7z" />
    </Base>
  );
}

// ── Brand mark — TT monogram circular, para badges e seals ─────────────
export function TudoTenisMark(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 8.5h4M9 8.5v8M13 8.5h4M15 8.5v8" />
    </Base>
  );
}
