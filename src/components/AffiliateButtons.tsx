import { AFFILIATES } from '@/lib/affiliates';

interface Props {
  /** Compacto (texto curto) ou full (com badge) */
  variant?: 'compact' | 'full';
  /** Texto antes do nome da casa (default: "Apostar @") */
  prefix?: string;
}

export function AffiliateButtons({ variant = 'compact', prefix = 'Apostar @' }: Props) {
  return (
    <div className="flex gap-2 flex-wrap">
      {AFFILIATES.map(a => (
        <a
          key={a.slug}
          href={a.trackingUrl}
          target="_blank"
          rel="sponsored noopener"
          className={`inline-flex items-center gap-2 transition ${
            a.primary
              ? 'bg-[var(--color-accent)] text-[var(--color-surface)] hover:opacity-90'
              : 'bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50'
          } ${
            variant === 'compact'
              ? 'px-3 py-2 rounded-lg text-sm font-semibold'
              : 'px-4 py-3 rounded-lg font-semibold'
          }`}
        >
          {prefix} <span className="font-extrabold">{a.name}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M7 17L17 7M17 7H7M17 7V17" />
          </svg>
        </a>
      ))}
    </div>
  );
}
