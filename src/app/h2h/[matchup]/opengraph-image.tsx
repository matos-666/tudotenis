import { ImageResponse } from 'next/og';
import { supabase } from '@/lib/supabase';
import { eloProb, parseMatchupSlug } from '@/lib/elo';

export const alt = 'TudoTénis · H2H Confronto';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image(
  { params }: { params: Promise<{ matchup: string }> | { matchup: string } }
) {
  const { matchup } = await Promise.resolve(params);
  const { data: all } = await supabase
    .from('players')
    .select('slug, name, flag, tour, atp_rank, photo_url, elo_overall')
    .eq('active', true);

  const knownSlugs = new Set((all ?? []).map(p => p.slug));
  const parsed = parseMatchupSlug(matchup, knownSlugs);

  if (!parsed) {
    return defaultOg('H2H não encontrado');
  }

  const [a, b] = parsed;
  const p1 = (all ?? []).find(p => p.slug === a);
  const p2 = (all ?? []).find(p => p.slug === b);

  if (!p1 || !p2) return defaultOg('H2H não encontrado');

  // ELO Order: stronger first
  const [P1, P2] = (p1.elo_overall ?? 0) >= (p2.elo_overall ?? 0) ? [p1, p2] : [p2, p1];

  const prob1 = eloProb(P1.elo_overall ?? 1500, P2.elo_overall ?? 1500);
  const probP1Pct = Math.round(prob1 * 100);
  const probP2Pct = 100 - probP1Pct;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #0a0e0f 0%, #11181a 100%)',
          padding: '60px',
          color: '#fff',
          position: 'relative',
        }}
      >
        {/* Brand */}
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: 999, background: '#d4ff3a' }} />
          Tudo<span style={{ color: '#d4ff3a' }}>Ténis</span>
          <span style={{ color: '#9aa3a6', marginLeft: 8 }}>· H2H</span>
        </div>

        {/* Title */}
        <div style={{ marginTop: 50, fontSize: 18, color: '#9aa3a6', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Probabilidade pelo modelo ELO
        </div>

        {/* Players row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flex: 1,
            gap: 30,
            marginTop: 20,
          }}
        >
          <PlayerCol p={P1} prob={probP1Pct} fav />
          <div style={{ fontSize: 56, fontWeight: 900, color: '#9aa3a6' }}>vs</div>
          <PlayerCol p={P2} prob={probP2Pct} fav={false} />
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
            marginTop: 'auto',
          }}
        >
          <span>tudotenis.com/h2h</span>
          <span>+27,6% yield · 439 tips · ELO próprio</span>
        </div>
      </div>
    ),
    { ...size }
  );
}

interface PlayerLite {
  slug: string;
  name: string;
  flag: string | null;
  tour: string;
  atp_rank: number | null;
  photo_url: string | null;
  elo_overall: number | null;
}

function PlayerCol({ p, prob, fav }: { p: PlayerLite; prob: number; fav: boolean }) {
  const initials = p.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <div
        style={{
          width: 220,
          height: 220,
          borderRadius: 24,
          background: fav
            ? 'linear-gradient(135deg, rgba(212,255,58,0.3), rgba(212,255,58,0.05))'
            : 'linear-gradient(135deg, rgba(255,164,114,0.2), rgba(255,164,114,0.05))',
          border: fav ? '3px solid #d4ff3a' : '2px solid rgba(255,164,114,0.5)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {p.photo_url ? (
          <img
            src={p.photo_url}
            alt={p.name}
            width={220}
            height={220}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
          />
        ) : (
          <span style={{ fontSize: 90, fontWeight: 900, color: fav ? '#d4ff3a' : '#ffa472' }}>{initials}</span>
        )}
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, marginTop: 18, textAlign: 'center', maxWidth: 380, lineHeight: 1.1 }}>
        {p.name}
      </div>
      <div style={{ fontSize: 22, color: '#9aa3a6', marginTop: 4, display: 'flex', gap: 8 }}>
        <span>{p.flag}</span>
        <span>·</span>
        <span>ELO {p.elo_overall ?? '—'}</span>
      </div>
      <div
        style={{
          fontSize: 64,
          fontWeight: 900,
          fontFamily: 'monospace',
          color: fav ? '#d4ff3a' : '#fff',
          marginTop: 14,
        }}
      >
        {prob}%
      </div>
    </div>
  );
}

function defaultOg(msg: string) {
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
          fontSize: 50,
          fontWeight: 700,
        }}
      >
        {msg}
      </div>
    ),
    { ...size }
  );
}
