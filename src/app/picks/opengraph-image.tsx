import { ImageResponse } from 'next/og';

export const alt = 'TudoTénis · Picks de Hoje';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

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
          color: '#fff',
          position: 'relative',
        }}
      >
        {/* Brand */}
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: 80,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          <div style={{ width: 12, height: 12, borderRadius: 999, background: '#d4ff3a' }} />
          <span>Tudo</span>
          <span style={{ color: '#d4ff3a' }}>Ténis</span>
        </div>

        {/* Live badge */}
        <div
          style={{
            position: 'absolute',
            top: 60,
            right: 80,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 18,
            color: '#d4ff3a',
            border: '2px solid rgba(212,255,58,0.4)',
            background: 'rgba(212,255,58,0.08)',
            padding: '10px 20px',
            borderRadius: 999,
            fontWeight: 700,
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: 999, background: '#d4ff3a' }} />
          <span>ACTUALIZADO HOJE</span>
        </div>

        {/* Title */}
        <div style={{ marginTop: 'auto', marginBottom: 30, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 30, color: '#9aa3a6', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
            Picks ELO de hoje
          </div>
          <div
            style={{
              fontSize: 90,
              fontWeight: 900,
              lineHeight: 1.0,
              letterSpacing: '-0.02em',
              display: 'flex',
              gap: 18,
            }}
          >
            <span>EV ≥</span>
            <span style={{ color: '#d4ff3a' }}>5%</span>
          </div>
          <div
            style={{
              fontSize: 50,
              fontWeight: 700,
              lineHeight: 1.1,
              marginTop: 16,
              color: '#9aa3a6',
            }}
          >
            ATP · WTA · Challengers
          </div>
        </div>

        {/* Stats */}
        <div
          style={{
            display: 'flex',
            gap: 70,
            paddingTop: 30,
            borderTop: '1px solid #1f2a2c',
          }}
        >
          <Stat label="Yield total" value="+27,6%" highlight />
          <Stat label="Tips auditados" value="439" />
          <Stat label="Win rate" value="48,5%" />
          <Stat label="Settlement" value="Auto" />
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
      <div style={{ fontSize: 42, fontWeight: 800, color: highlight ? '#d4ff3a' : '#fff', fontFamily: 'monospace' }}>
        {value}
      </div>
    </div>
  );
}
