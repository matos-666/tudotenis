import { ImageResponse } from 'next/og';

export const alt = 'TudoTénis · Picks ELO + Stats Avançadas';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * OG image da homepage. Gerada uma única vez e cached pelo CDN da Vercel.
 */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #0a0e0f 0%, #11181a 100%)',
          padding: '80px',
          position: 'relative',
        }}
      >
        {/* Accent dot */}
        <div
          style={{
            position: 'absolute',
            top: 80,
            right: 80,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            color: '#d4ff3a',
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          <div style={{ width: 12, height: 12, borderRadius: 999, background: '#d4ff3a' }} />
          <span>tudotenis.com</span>
        </div>

        {/* Logo wordmark */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            letterSpacing: '-0.02em',
            color: '#fff',
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <span>Tudo</span>
          <span style={{ color: '#d4ff3a' }}>Ténis</span>
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#d4ff3a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M3.5 8.5C6.5 9.5 8.5 11.5 8.5 14.5C8.5 17 7 19 5 20.5" />
            <path d="M20.5 8.5C17.5 9.5 15.5 11.5 15.5 14.5C15.5 17 17 19 19 20.5" />
          </svg>
        </div>

        {/* Tagline */}
        <div
          style={{
            marginTop: 30,
            fontSize: 56,
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            maxWidth: 900,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0 14px',
          }}
        >
          <span>Picks ELO +</span>
          <span style={{ color: '#d4ff3a' }}>stats</span>
          <span>que ninguém mais publica em português.</span>
        </div>

        {/* Stats */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            gap: 60,
            paddingTop: 40,
            borderTop: '1px solid #1f2a2c',
          }}
        >
          <Stat label="Yield total" value="+27,6%" highlight />
          <Stat label="Tips auditados" value="439" />
          <Stat label="Win rate" value="48,5%" />
          <Stat label="Jogadores" value="2.557" />
        </div>
      </div>
    ),
    { ...size }
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 16, color: '#9aa3a6', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 40, fontWeight: 800, color: highlight ? '#d4ff3a' : '#fff', fontFamily: 'monospace' }}>
        {value}
      </div>
    </div>
  );
}
