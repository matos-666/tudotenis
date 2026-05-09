import { ImageResponse } from 'next/og';
import { supabase } from '@/lib/supabase';

export const alt = 'TudoTénis · Perfil de Jogador';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image(
  { params }: { params: Promise<{ slug: string }> | { slug: string } }
) {
  const { slug } = await Promise.resolve(params);
  const { data: p } = await supabase
    .from('players')
    .select('name, flag, country, tour, atp_rank, photo_url, elo_overall, elo_hard, elo_clay, elo_grass, elo_30d_ago')
    .eq('slug', slug)
    .single();

  if (!p) {
    return defaultImage();
  }

  const delta = p.elo_overall && p.elo_30d_ago ? p.elo_overall - p.elo_30d_ago : null;
  const initials = (p.name as string).split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          background: 'linear-gradient(135deg, #0a0e0f 0%, #11181a 100%)',
          padding: '70px',
          color: '#fff',
        }}
      >
        {/* Brand top-left */}
        <div
          style={{
            position: 'absolute',
            top: 50,
            left: 70,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: 999, background: '#d4ff3a' }} />
          Tudo<span style={{ color: '#d4ff3a' }}>Ténis</span>
        </div>

        {/* Photo / initials */}
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: 32,
            background: 'linear-gradient(135deg, rgba(212,255,58,0.3), rgba(212,255,58,0.05))',
            border: '3px solid rgba(212,255,58,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
            marginTop: 'auto',
            marginBottom: 'auto',
          }}
        >
          {p.photo_url ? (
            <img
              src={p.photo_url as string}
              alt={p.name as string}
              width={320}
              height={320}
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
            />
          ) : (
            <span style={{ fontSize: 130, fontWeight: 900, color: '#d4ff3a' }}>{initials}</span>
          )}
        </div>

        {/* Right side: data */}
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 60, flex: 1 }}>
          <div style={{ fontSize: 28, color: '#9aa3a6', marginBottom: 8 }}>
            {(p.tour as string).toUpperCase()} {p.atp_rank ? `· #${p.atp_rank}` : ''}
          </div>
          <div
            style={{
              fontSize: 84,
              fontWeight: 900,
              letterSpacing: '-0.02em',
              lineHeight: 1.0,
              marginBottom: 4,
              display: 'flex',
              alignItems: 'baseline',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            {p.name}
          </div>
          <div style={{ fontSize: 56, marginBottom: 30 }}>{p.flag ?? ''}</div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '28px 32px',
              background: 'rgba(212,255,58,0.08)',
              border: '2px solid rgba(212,255,58,0.3)',
              borderRadius: 20,
              gap: 6,
            }}
          >
            <div style={{ fontSize: 18, color: '#9aa3a6', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ELO Geral
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
              <span style={{ fontSize: 88, fontWeight: 900, color: '#d4ff3a', fontFamily: 'monospace' }}>
                {p.elo_overall ?? '—'}
              </span>
              {delta != null && (
                <span style={{ fontSize: 28, color: delta >= 0 ? '#6dd97a' : '#ff7a7a' }}>
                  {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)} (30d)
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 18, color: '#9aa3a6' }}>
              <span>Hard {p.elo_hard ?? '—'}</span>
              <span>·</span>
              <span>Saibro {p.elo_clay ?? '—'}</span>
              <span>·</span>
              <span>Grama {p.elo_grass ?? '—'}</span>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}

function defaultImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0e0f',
          color: '#fff',
          fontSize: 60,
          fontWeight: 800,
          gap: 6,
        }}
      >
        <span>Tudo</span>
        <span style={{ color: '#d4ff3a' }}>Ténis</span>
      </div>
    ),
    { ...size }
  );
}
