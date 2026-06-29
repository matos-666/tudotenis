/**
 * TournamentTopInsights — bloco hero acima da página de torneio.
 *
 * Substitui o scatter ELO Geral vs Surface (que era confuso porque a
 * maioria dos jogadores fica abaixo da paridade) por duas leituras
 * accionáveis em 5 segundos:
 *
 *  1. Sobem na surface
 *     Quem ganha mais posições passando do ELO geral para o ELO da
 *     surface deste torneio.
 *       "Sonego: #45 geral → #12 em relvado  (+33 ↑)"
 *
 *  2. Upset radar
 *     Jogadores fora do top 25 ATP/WTA mas com ELO top-20 na surface
 *     do torneio — candidatos a surpresas.
 *
 * Server component, sem JS no cliente.
 */
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { surfaceLabel, type Locale } from '@/lib/i18n';
import { TargetIcon } from '@/components/icons';

const SURFACE_COL = {
  hard: 'elo_set_hard',
  clay: 'elo_set_clay',
  grass: 'elo_set_grass',
} as const;

interface Row {
  id: number;
  slug: string;
  name: string;
  flag: string | null;
  photo_url: string | null;
  atp_rank: number | null;
  elo_set_overall: number | null;
  elo_set_surface: number | null;
}

export async function TournamentTopInsights({
  tour,
  surface,
  locale,
  prefix,
}: {
  tour: 'atp' | 'wta';
  surface: string;          // 'hard' | 'clay' | 'grass' | 'indoor'
  locale: Locale;
  prefix: string;
}) {
  // Indoor → hard (não temos ratings indoor próprios)
  const surfRaw = surface.toLowerCase();
  const surfKey = (surfRaw === 'indoor' ? 'hard' : surfRaw) as keyof typeof SURFACE_COL;
  const surfCol = SURFACE_COL[surfKey];
  if (!surfCol) return null;

  const surfLbl = surfaceLabel(locale, surfKey).toLowerCase();

  const { data, error } = await supabase
    .from('players')
    .select(
      `id, slug, name, flag, photo_url, atp_rank, elo_set_overall, elo_set_surface:${surfCol}`,
    )
    .eq('tour', tour)
    .eq('active', true)
    .gte('set_count', 100)
    .not('elo_set_overall', 'is', null)
    .not(surfCol, 'is', null)
    .order('elo_set_overall', { ascending: false, nullsFirst: false })
    .limit(150);

  if (error) {
    console.error('[TournamentTopInsights]', error.message);
    return null;
  }

  const rows = (data ?? []) as unknown as Row[];
  if (rows.length < 20) return null;

  // Compute internal rankings (overall ELO rank vs surface ELO rank)
  const byOverall = [...rows].sort(
    (a, b) => (b.elo_set_overall ?? 0) - (a.elo_set_overall ?? 0),
  );
  const overallRank = new Map<number, number>();
  byOverall.forEach((p, i) => overallRank.set(p.id, i + 1));

  const bySurface = [...rows].sort(
    (a, b) => (b.elo_set_surface ?? 0) - (a.elo_set_surface ?? 0),
  );
  const surfaceRank = new Map<number, number>();
  bySurface.forEach((p, i) => surfaceRank.set(p.id, i + 1));

  // Risers: ganha ≥5 posições E está dentro do top 30 da surface (relevante)
  const risers = rows
    .map(p => {
      const oRank = overallRank.get(p.id)!;
      const sRank = surfaceRank.get(p.id)!;
      return { p, oRank, sRank, delta: oRank - sRank };
    })
    .filter(x => x.delta >= 5 && x.sRank <= 30)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 6);

  // Upsets: ATP rank > 25 (não é cabeça-de-série) com surface_rank ≤ 20
  const upsets = rows
    .map(p => {
      const sRank = surfaceRank.get(p.id)!;
      return { p, sRank, atpRank: p.atp_rank };
    })
    .filter(x => x.atpRank != null && x.atpRank > 25 && x.sRank <= 20)
    .sort((a, b) => a.sRank - b.sRank)
    .slice(0, 5);

  if (risers.length === 0 && upsets.length === 0) return null;

  const tourUpper = tour.toUpperCase();
  // Largura máxima da barra de delta para escala visual
  const maxDelta = risers.reduce((m, r) => Math.max(m, r.delta), 0);

  return (
    <div className="grid md:grid-cols-2 gap-3 md:gap-4 mb-6">
      {/* ── Risers ── */}
      {risers.length > 0 && (
        <div className="stat-card p-4 md:p-5">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-1">
            <h3 className="font-bold text-sm md:text-base flex items-center gap-1.5">
              <span>📈</span>
              <span>Sobem em {surfLbl}</span>
            </h3>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">
              {tourUpper}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mb-3 leading-snug">
            Quem ganha mais posições passando do ELO geral para o ELO de{' '}
            {surfLbl}. Specialists ocultos pela classificação oficial.
          </p>
          <ul className="space-y-1.5">
            {risers.map(({ p, oRank, sRank, delta }) => {
              const initials = p.name
                .split(' ')
                .map(n => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
              const barPct = maxDelta > 0 ? (delta / maxDelta) * 100 : 0;
              return (
                <li key={p.id}>
                  <Link
                    href={`${prefix}/jogador/${p.slug}`}
                    className="flex items-center gap-2.5 -mx-1 px-1.5 py-1.5 rounded hover:bg-[var(--color-card)] transition"
                  >
                    <div className="relative w-9 h-9 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {p.photo_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={p.photo_url}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                          style={{ objectPosition: 'top center' }}
                        />
                      ) : (
                        <span className="text-[10px] font-bold text-gray-500">
                          {initials}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate flex items-center gap-1">
                        <span className="truncate">{p.name}</span>
                        {p.flag && (
                          <span className="text-[10px] text-gray-500 shrink-0">
                            {p.flag}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
                          #{oRank}{' '}
                          <span className="text-gray-600">→</span>{' '}
                          <span className="text-[var(--color-accent)] font-bold">
                            #{sRank}
                          </span>
                        </span>
                        <div className="flex-1 h-1 bg-[var(--color-card)] rounded-full overflow-hidden min-w-[20px]">
                          <div
                            className="h-full bg-[var(--color-accent)] rounded-full"
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="text-[var(--color-accent)] font-mono font-bold text-sm whitespace-nowrap">
                      +{delta}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Upset radar ── */}
      {upsets.length > 0 && (
        <div className="stat-card p-4 md:p-5">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-1">
            <h3 className="font-bold text-sm md:text-base flex items-center gap-1.5">
              <TargetIcon size={16} className="text-[var(--color-accent)]" />
              <span>Upset radar</span>
            </h3>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">
              {tourUpper}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mb-3 leading-snug">
            Fora do top 25 oficial mas com ELO top-20 em {surfLbl}. Os nomes a
            ter cuidado num cruzamento inicial.
          </p>
          <ul className="space-y-1.5">
            {upsets.map(({ p, sRank, atpRank }) => {
              const initials = p.name
                .split(' ')
                .map(n => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
              return (
                <li key={p.id}>
                  <Link
                    href={`${prefix}/jogador/${p.slug}`}
                    className="flex items-center gap-2.5 -mx-1 px-1.5 py-1.5 rounded hover:bg-[var(--color-card)] transition"
                  >
                    <div className="relative w-9 h-9 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {p.photo_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={p.photo_url}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                          style={{ objectPosition: 'top center' }}
                        />
                      ) : (
                        <span className="text-[10px] font-bold text-gray-500">
                          {initials}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate flex items-center gap-1">
                        <span className="truncate">{p.name}</span>
                        {p.flag && (
                          <span className="text-[10px] text-gray-500 shrink-0">
                            {p.flag}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                        Oficial <span className="text-gray-400">#{atpRank}</span>
                        {' · '}
                        ELO {surfLbl}{' '}
                        <span className="text-orange-400 font-bold">
                          #{sRank}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
