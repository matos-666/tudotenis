import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AffiliateButtons } from '@/components/AffiliateButtons';
import { supabase } from '@/lib/supabase';

export const metadata: Metadata = {
  title: 'Picks do dia · ELO + Edge · TudoTénis',
  description:
    'Picks de ténis publicados pelo modelo ELO TudoTénis. Yield comprovado +27,6% em 439 tips auditadas. Saibro, hard, grama. ATP, WTA e Challengers.',
  alternates: { canonical: '/picks' },
};

export const revalidate = 600; // 10 min

// ── Types ─────────────────────────────────────────────────────────────────
interface Pick {
  id: number;
  player_id: number | null;
  market: string;
  selection: string;
  odd: number;
  edge_pct: number;
  grade: 'A' | 'B' | 'C';
  stake: number;
  result: 'win' | 'loss' | 'void' | null;
  pl: number | null;
  posted_at: string;
  settled_at: string | null;
  p1_name: string | null;
  p2_name: string | null;
  p1_flag: string | null;
  p2_flag: string | null;
  tournament_name: string | null;
  surface: string | null;
  scheduled_at: string | null;
  // Enriched at fetch time from players table:
  p1_photo_url?: string | null;
  p2_photo_url?: string | null;
  p1_slug?: string | null;
  p2_slug?: string | null;
}

async function enrichWithPlayers(picks: Pick[]): Promise<Pick[]> {
  const names = new Set<string>();
  for (const p of picks) {
    if (p.p1_name) names.add(p.p1_name);
    if (p.p2_name) names.add(p.p2_name);
  }
  if (names.size === 0) return picks;

  const { data } = await supabase
    .from('players')
    .select('name, photo_url, slug')
    .in('name', Array.from(names));

  const byName = new Map<string, { photo_url: string | null; slug: string }>();
  for (const r of data ?? []) {
    byName.set(r.name, { photo_url: r.photo_url, slug: r.slug });
  }

  return picks.map(p => ({
    ...p,
    p1_photo_url: p.p1_name ? byName.get(p.p1_name)?.photo_url ?? null : null,
    p2_photo_url: p.p2_name ? byName.get(p.p2_name)?.photo_url ?? null : null,
    p1_slug:      p.p1_name ? byName.get(p.p1_name)?.slug      ?? null : null,
    p2_slug:      p.p2_name ? byName.get(p.p2_name)?.slug      ?? null : null,
  }));
}

// ── Data fetching ─────────────────────────────────────────────────────────
async function fetchTodayPicks(): Promise<Pick[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('picks')
    .select('*')
    .gte('posted_at', `${today}T00:00:00`)
    .order('grade', { ascending: true })
    .order('edge_pct', { ascending: false });

  if (error) {
    console.error('[picks] today error:', error.message);
    return [];
  }
  return enrichWithPlayers((data ?? []) as Pick[]);
}

async function fetchYesterdayPicks(): Promise<Pick[]> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('picks')
    .select('*')
    .gte('posted_at', `${yesterday}T00:00:00`)
    .lt('posted_at', `${yesterday}T23:59:59`)
    .not('result', 'is', null)
    .order('posted_at', { ascending: false });

  if (error) {
    console.error('[picks] yesterday error:', error.message);
    return [];
  }
  return enrichWithPlayers((data ?? []) as Pick[]);
}

// ── Helpers ───────────────────────────────────────────────────────────────
const SURFACE_CLASS  = { clay: 'surface-clay', hard: 'surface-hard', grass: 'surface-grass', indoor: 'surface-indoor' } as const;
const SURFACE_LABEL  = { clay: 'Saibro', hard: 'Hard', grass: 'Grama', indoor: 'Indoor' } as const;

function surfaceKey(s: string | null): keyof typeof SURFACE_CLASS {
  if (s && s in SURFACE_CLASS) return s as keyof typeof SURFACE_CLASS;
  return 'hard';
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
}

function isLive(p: Pick): boolean {
  if (!p.scheduled_at) return false;
  const diff = Date.now() - new Date(p.scheduled_at).getTime();
  return diff >= 0 && diff < 3 * 60 * 60 * 1000; // 0..3h after scheduled start
}

function PlayerAvatar({
  src,
  flag,
  name,
  size = 'sm',
}: {
  src: string | null | undefined;
  flag: string | null;
  name: string;
  size?: 'sm' | 'xs';
}) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const dim = size === 'sm' ? 'w-8 h-8' : 'w-6 h-6';
  return (
    <div className={`relative ${dim} rounded-full bg-[var(--color-card)] border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          loading="lazy"
          className="w-full h-full object-cover"
          style={{ objectPosition: 'top center' }}
        />
      ) : (
        <span className="text-[9px] font-bold text-gray-500">{initials || '·'}</span>
      )}
      {flag && (
        <span
          className="absolute -bottom-0 -right-0 text-[7px] leading-none bg-[var(--color-surface)] rounded-tl px-px"
          aria-hidden="true"
        >
          {flag}
        </span>
      )}
    </div>
  );
}

// ── Pick Card ─────────────────────────────────────────────────────────────
function PickCard({ p }: { p: Pick }) {
  const live = isLive(p);
  const surf = surfaceKey(p.surface);
  const time = formatTime(p.scheduled_at);

  return (
    <div className={`stat-card p-4 md:p-5 ${live ? 'border-red-500/40 shadow-lg shadow-red-500/5' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <span className="text-xs text-gray-500">{p.tournament_name ?? 'ATP/WTA'}</span>
        <div className="flex gap-2 items-center">
          <span className={`surface-pill ${SURFACE_CLASS[surf]}`}>{SURFACE_LABEL[surf]}</span>
          {live && (
            <span className="text-[10px] uppercase font-bold tracking-wider text-red-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              LIVE
            </span>
          )}
          {!live && time && (
            <span className="text-[10px] uppercase font-bold text-blue-400">⏱ {time}</span>
          )}
        </div>
      </div>

      {/* Players — side-by-side com foto */}
      <div className="flex items-center gap-2 mb-3">
        {/* P1 (selection / favorito) */}
        <div className="flex items-center gap-1.5 md:gap-2 flex-1 min-w-0">
          <PlayerAvatar src={p.p1_photo_url} flag={p.p1_flag} name={p.p1_name ?? p.selection} />
          <span className="font-semibold text-sm md:text-base truncate">
            {p.p1_name ?? p.selection}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-gray-600 shrink-0">vs</span>
        {/* P2 (adversário) */}
        <div className="flex items-center gap-1.5 md:gap-2 flex-1 min-w-0 justify-end">
          <span className="text-gray-400 text-sm md:text-base truncate">
            {p.p2_name ?? '–'}
          </span>
          <PlayerAvatar src={p.p2_photo_url} flag={p.p2_flag} name={p.p2_name ?? ''} />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-end justify-between pt-3 border-t border-[var(--color-border)] mb-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Aposta</div>
          <div className="font-semibold text-sm">{p.market}</div>
          <div className="text-xs">@ <span className="text-[var(--color-accent)] font-mono font-semibold">{Number(p.odd).toFixed(2)}</span></div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500 mb-1">Edge</div>
          <div className="font-bold text-[var(--color-accent)]">+{Number(p.edge_pct).toFixed(1)}%</div>
        </div>
        <span className={`grade-${p.grade} px-2 py-1 rounded text-xs font-bold`}>{p.grade}</span>
      </div>

      {/* CTAs */}
      <AffiliateButtons variant="compact" prefix="Apostar @" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default async function PicksPage() {
  const [today, yesterday] = await Promise.all([
    fetchTodayPicks(),
    fetchYesterdayPicks(),
  ]);

  const liveCount    = today.filter(isLive).length;
  const pendingCount = today.filter(p => !isLive(p) && !p.result).length;

  const ydayWins  = yesterday.filter(p => p.result === 'win').length;
  const ydayLoss  = yesterday.filter(p => p.result === 'loss').length;
  const ydayPL    = yesterday.reduce((s, p) => s + (p.pl ?? 0), 0);
  const ydayYield = yesterday.length > 0 ? (ydayPL / (yesterday.length * 10)) * 100 : 0;

  const noPicksToday = today.length === 0;

  return (
    <>
      <Header />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">

          {/* Hero */}
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-full px-3 py-1 text-xs mb-4 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
              {liveCount} ao vivo · {pendingCount} pendentes · modelo ELO
            </div>
            <h1 className="text-2xl md:text-4xl font-extrabold mb-2">Picks de hoje</h1>
            <p className="text-gray-400 text-sm md:text-base mb-6">
              Edge ≥ 5% · grades A/B/C · settlement automático após cada jogo
            </p>

            {/* Performance KPIs — histórico do modelo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">Yield total</div>
                <div className="text-xl md:text-2xl font-extrabold text-[var(--color-accent)] font-mono">+27,6%</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">P&amp;L acumulado</div>
                <div className="text-xl md:text-2xl font-extrabold text-[var(--color-accent)] font-mono">+€8.189</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">Tips totais</div>
                <div className="text-xl md:text-2xl font-extrabold font-mono">439</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">Win rate</div>
                <div className="text-xl md:text-2xl font-extrabold font-mono">48,5%</div>
              </div>
            </div>
          </div>

          {/* Picks de hoje */}
          <h2 className="text-xl font-bold mb-4">
            Picks · {new Date().toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}
          </h2>

          {noPicksToday ? (
            <div className="stat-card p-8 text-center mb-12">
              <div className="text-3xl mb-3">⏳</div>
              <div className="font-semibold mb-1">Sem picks publicados ainda</div>
              <p className="text-xs text-gray-500">
                O modelo analisa os jogos do dia às 06:30 UTC.<br />
                Volta mais tarde ou activa notificações.
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
              {today.map(p => <PickCard key={p.id} p={p} />)}
            </div>
          )}

          {/* Resultados de ontem */}
          {yesterday.length > 0 && (
            <div className="border-t border-[var(--color-border)] pt-10 mb-10">
              <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-bold">Resultados · ontem</h2>
                  <p className="text-xs text-gray-500 mt-1">Settled automaticamente via BetExplorer</p>
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="text-center">
                    <div className="text-xs text-gray-500">V-D</div>
                    <div className="font-bold">
                      <span className="win">{ydayWins}</span>-<span className="loss">{ydayLoss}</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Yield</div>
                    <div className="font-bold text-[var(--color-accent)]">
                      {ydayYield >= 0 ? '+' : ''}{ydayYield.toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">P&amp;L</div>
                    <div className={`font-bold ${ydayPL >= 0 ? 'text-[var(--color-accent)]' : 'loss'}`}>
                      {ydayPL >= 0 ? '+' : ''}€{Math.abs(ydayPL).toFixed(0)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="stat-card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-surface)]">
                    <tr className="text-gray-500 text-xs uppercase">
                      <th className="text-left p-3 md:p-4 font-medium">Jogador</th>
                      <th className="hidden sm:table-cell text-left p-4 font-medium">Adversário</th>
                      <th className="text-left p-3 md:p-4 font-medium">Aposta</th>
                      <th className="text-right p-3 md:p-4 font-medium">Quota</th>
                      <th className="text-right p-3 md:p-4 font-medium">Resultado</th>
                      <th className="text-right p-3 md:p-4 font-medium">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {yesterday.map(p => (
                      <tr key={p.id} className="border-t border-[var(--color-border)]">
                        <td className="p-2 md:p-4 font-sans font-semibold">
                          <div className="flex items-center gap-2">
                            <PlayerAvatar src={p.p1_photo_url} flag={p.p1_flag} name={p.p1_name ?? p.selection} size="xs" />
                            <span className="truncate">{p.p1_name ?? p.selection}</span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell p-4 font-sans text-gray-400">
                          <div className="flex items-center gap-2">
                            <PlayerAvatar src={p.p2_photo_url} flag={p.p2_flag} name={p.p2_name ?? ''} size="xs" />
                            <span className="truncate">{p.p2_name ?? '–'}</span>
                          </div>
                        </td>
                        <td className="p-3 md:p-4 font-sans text-xs">{p.market}</td>
                        <td className="text-right p-3 md:p-4">{Number(p.odd).toFixed(2)}</td>
                        <td className="text-right p-3 md:p-4">
                          {p.result === 'win'  ? <span className="win">✓ WIN</span>
                           : p.result === 'loss' ? <span className="loss">✗ LOSS</span>
                           : <span className="void">⊘ VOID</span>}
                        </td>
                        <td className={`text-right p-3 md:p-4 ${(p.pl ?? 0) > 0 ? 'win' : (p.pl ?? 0) < 0 ? 'loss' : 'void'}`}>
                          {(p.pl ?? 0) > 0 ? `+€${Number(p.pl).toFixed(0)}` : (p.pl ?? 0) < 0 ? `-€${Math.abs(Number(p.pl)).toFixed(0)}` : '€0'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty yesterday state */}
          {yesterday.length === 0 && (
            <div className="border-t border-[var(--color-border)] pt-10 mb-10">
              <h2 className="text-xl font-bold mb-3">Resultados · ontem</h2>
              <p className="text-xs text-gray-500">
                Sem picks settled de ontem ainda. O settlement corre automaticamente à meia-noite.
              </p>
            </div>
          )}

          {/* CTA final */}
          <div className="stat-card p-6 md:p-8 border-[var(--color-accent)]/30 text-center">
            <h3 className="text-xl font-bold mb-2">Pronto para apostar?</h3>
            <p className="text-sm text-gray-400 mb-5">
              Os nossos picks são publicados antes do fecho das casas. Aproveita as melhores quotas.
            </p>
            <div className="flex justify-center">
              <AffiliateButtons variant="full" prefix="Abrir conta @" />
            </div>
            <p className="text-xs text-gray-600 mt-5">
              +18 · Joga responsável · Apostas envolvem risco de perda
            </p>
          </div>

        </div>
      </main>
      <Footer />
    </>
  );
}
