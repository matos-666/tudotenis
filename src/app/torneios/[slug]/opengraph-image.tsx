import { ImageResponse } from 'next/og';
import { supabase } from '@/lib/supabase';

export const alt = 'TudoTénis · Torneio';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const SURFACE_COLOR: Record<string, { bg: string; fg: string; label: string }> = {
  clay:   { bg: '#c9572422', fg: '#ffa472', label: 'Saibro' },
  hard:   { bg: '#2c5fc922', fg: '#7fa8ff', label: 'Hard'   },
  grass:  { bg: '#3a8a3a22', fg: '#a3e0a3', label: 'Grama'  },
  indoor: { bg: '#6b4ec722', fg: '#c4a8ff', label: 'Indoor' },
};

const CAT_LABEL: Record<string, string> = {
  slam: 'Grand Slam',
  '1000': 'Masters 1000',
  '500': 'ATP/WTA 500',
  '250': 'ATP 250',
  finals: 'Finals',
};

export default async function Image(
  { params }: { params: Promise<{ slug: string }> | { slug: string } }
) {
  const { slug } = await Promise.resolve(params);
  const { data: t } = await supabase
    .from('tournaments')
    .select('name, year, tour, category, surface, flag, location, start_date, end_date, status')
    .eq('slug', slug)
    .single();

  if (!t) {
    return new ImageResponse(
      (
        <div style={{ display: 'flex', height: '100%', width: '100%', background: '#0a0e0f', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 60 }}>
          Torneio não encontrado
        </div>
      ),
      { ...size }
    );
  }

  const surf = SURFACE_COLOR[t.surface as string] ?? SURFACE_COLOR.hard;
  const catLabel = CAT_LABEL[t.category as string] ?? t.category;

  // Format dates
  const fmtDate = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
  };
  const dateRange = t.start_date && t.end_date
    ? `${fmtDate(t.start_date)} → ${fmtDate(t.end_date)} ${t.year}`
    : `${t.year}`;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: `linear-gradient(135deg, #0a0e0f 0%, ${surf.bg.replace('22', '40')} 100%)`,
          padding: '70px',
          color: '#fff',
          position: 'relative',
        }}
      >
        {/* Brand */}
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
          <span>Tudo</span>
          <span style={{ color: '#d4ff3a' }}>Ténis</span>
        </div>

        {/* Top right: surface pill */}
        <div
          style={{
            position: 'absolute',
            top: 50,
            right: 70,
            background: surf.bg,
            color: surf.fg,
            border: `2px solid ${surf.fg}40`,
            padding: '10px 22px',
            borderRadius: 999,
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          {surf.label}
        </div>

        {/* Title */}
        <div style={{ marginTop: 'auto', marginBottom: 30, display: 'flex', alignItems: 'center', gap: 24 }}>
          <span style={{ fontSize: 90 }}>{t.flag ?? '🎾'}</span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: 80,
                fontWeight: 900,
                lineHeight: 1.0,
                letterSpacing: '-0.02em',
              }}
            >
              {t.name}
            </div>
            <div style={{ fontSize: 28, color: '#9aa3a6', marginTop: 16 }}>
              {dateRange} · {(t.tour as string).toUpperCase()} {catLabel}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            paddingTop: 16,
            fontSize: 18,
            color: '#9aa3a6',
            borderTop: '1px solid #1f2a2c',
          }}
        >
          <span>tudotenis.com/torneios</span>
          <span>Modelo ELO · 2.557 jogadores · 59k jogos analisados</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
