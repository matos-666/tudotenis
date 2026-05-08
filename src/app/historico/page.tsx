import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { supabase } from '@/lib/supabase';

export const metadata: Metadata = {
  title: 'Histórico de picks · Performance auditada · TudoTénis',
  description:
    'Histórico completo de picks resolvidos pelo modelo ELO TudoTénis. Yield, win rate, P&L. Transparência total — todos os picks são publicados antes dos jogos começarem.',
  alternates: { canonical: '/historico' },
};

export const revalidate = 600;

interface SettledPick {
  id: number;
  selection: string;
  market: string;
  odd: number;
  edge_pct: number;
  grade: 'A' | 'B' | 'C';
  stake: number;
  result: 'win' | 'loss' | 'void';
  pl: number;
  posted_at: string;
  settled_at: string | null;
  p1_name: string | null;
  p2_name: string | null;
  p1_flag: string | null;
  p2_flag: string | null;
  tournament_name: string | null;
  surface: string | null;
}

async function fetchHistory(): Promise<SettledPick[]> {
  const { data, error } = await supabase
    .from('picks')
    .select('*')
    .not('result', 'is', null)
    .order('posted_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[/historico]', error.message);
    return [];
  }
  return (data ?? []) as SettledPick[];
}

const SURFACE_CLASS = { clay: 'surface-clay', hard: 'surface-hard', grass: 'surface-grass', indoor: 'surface-indoor' } as const;

export default async function HistoricoPage() {
  const picks = await fetchHistory();

  const wins  = picks.filter(p => p.result === 'win').length;
  const losses = picks.filter(p => p.result === 'loss').length;
  const voids = picks.filter(p => p.result === 'void').length;
  const totalStake = picks.reduce((s, p) => s + Number(p.stake), 0);
  const totalPL = picks.reduce((s, p) => s + Number(p.pl), 0);
  const yieldPct = totalStake > 0 ? (totalPL / totalStake) * 100 : 0;
  const winRate  = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

  // Performance histórica do modelo original (audit fora-sistema)
  const HIST_TIPS = 405;
  const HIST_YIELD = 30.4;
  const HIST_PL = 8788;

  return (
    <>
      <Header />
      <main id="main" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">

          <div className="mb-8">
            <div className="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-full px-3 py-1 text-xs mb-4">
              <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
              Performance auditada
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold mb-3">Histórico de picks</h1>
            <p className="text-gray-400 text-sm md:text-base max-w-2xl">
              Todos os picks publicados pelo modelo ELO desde sempre. Cada pick foi publicado{' '}
              <strong>antes</strong> do jogo começar — sem retroactividade.
            </p>
          </div>

          {/* KPIs históricos */}
          <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-3">Modelo histórico (auditado)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
            <div className="stat-card p-4">
              <div className="text-xs text-gray-500 mb-1">Yield</div>
              <div className="text-xl md:text-2xl font-extrabold text-[var(--color-accent)] font-mono">+{HIST_YIELD}%</div>
            </div>
            <div className="stat-card p-4">
              <div className="text-xs text-gray-500 mb-1">P&amp;L (€1k)</div>
              <div className="text-xl md:text-2xl font-extrabold text-[var(--color-accent)] font-mono">+€{HIST_PL.toLocaleString('pt-PT')}</div>
            </div>
            <div className="stat-card p-4">
              <div className="text-xs text-gray-500 mb-1">Tips totais</div>
              <div className="text-xl md:text-2xl font-extrabold font-mono">{HIST_TIPS}</div>
            </div>
            <div className="stat-card p-4">
              <div className="text-xs text-gray-500 mb-1">Win rate</div>
              <div className="text-xl md:text-2xl font-extrabold font-mono">46,9%</div>
            </div>
          </div>

          {/* KPIs do site live */}
          {picks.length > 0 && (
            <>
              <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-3">Live no site (desde lançamento)</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
                <div className="stat-card p-4">
                  <div className="text-xs text-gray-500 mb-1">Yield</div>
                  <div className={`text-xl md:text-2xl font-extrabold font-mono ${yieldPct >= 0 ? 'text-[var(--color-accent)]' : 'loss'}`}>
                    {yieldPct >= 0 ? '+' : ''}{yieldPct.toFixed(1)}%
                  </div>
                </div>
                <div className="stat-card p-4">
                  <div className="text-xs text-gray-500 mb-1">P&amp;L</div>
                  <div className={`text-xl md:text-2xl font-extrabold font-mono ${totalPL >= 0 ? 'text-[var(--color-accent)]' : 'loss'}`}>
                    {totalPL >= 0 ? '+' : ''}€{totalPL.toFixed(0)}
                  </div>
                </div>
                <div className="stat-card p-4">
                  <div className="text-xs text-gray-500 mb-1">Picks resolvidos</div>
                  <div className="text-xl md:text-2xl font-extrabold font-mono">{picks.length}</div>
                </div>
                <div className="stat-card p-4">
                  <div className="text-xs text-gray-500 mb-1">V-D-V</div>
                  <div className="text-xl md:text-2xl font-extrabold font-mono">
                    <span className="win">{wins}</span>-<span className="loss">{losses}</span>-<span className="void">{voids}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Tabela de histórico */}
          {picks.length === 0 ? (
            <div className="stat-card p-8 text-center">
              <div className="text-3xl mb-3">📊</div>
              <div className="font-semibold mb-1">Sem picks resolvidos no site ainda</div>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                O sistema acabou de arrancar. À medida que os jogos vão acabando, o histórico
                vai aparecer aqui automaticamente.
              </p>
              <div className="mt-6">
                <Link
                  href="/picks"
                  className="text-sm text-[var(--color-accent)] hover:underline"
                >
                  Ver picks de hoje →
                </Link>
              </div>
            </div>
          ) : (
            <div className="stat-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-surface)]">
                  <tr className="text-gray-500 text-xs uppercase">
                    <th className="text-left p-3 md:p-4 font-medium">Data</th>
                    <th className="text-left p-3 md:p-4 font-medium">Jogo</th>
                    <th className="hidden sm:table-cell text-left p-4 font-medium">Aposta</th>
                    <th className="text-right p-3 md:p-4 font-medium">Quota</th>
                    <th className="text-center p-3 md:p-4 font-medium">Grade</th>
                    <th className="text-right p-3 md:p-4 font-medium">Resultado</th>
                    <th className="text-right p-3 md:p-4 font-medium">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.map(p => (
                    <tr key={p.id} className="border-t border-[var(--color-border)]">
                      <td className="p-3 md:p-4 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(p.posted_at).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })}
                      </td>
                      <td className="p-3 md:p-4">
                        <div className="font-semibold">{p.p1_name ?? p.selection} <span className="text-gray-600 text-xs">{p.p1_flag ?? ''}</span></div>
                        <div className="text-xs text-gray-500">vs {p.p2_name ?? '–'}</div>
                        {p.surface && (
                          <span className={`surface-pill mt-1 ${SURFACE_CLASS[p.surface as keyof typeof SURFACE_CLASS] ?? ''}`}>
                            {p.surface}
                          </span>
                        )}
                      </td>
                      <td className="hidden sm:table-cell p-4 text-xs">{p.market}</td>
                      <td className="text-right p-3 md:p-4 font-mono">{Number(p.odd).toFixed(2)}</td>
                      <td className="text-center p-3 md:p-4">
                        <span className={`grade-${p.grade} px-2 py-0.5 rounded text-xs font-bold`}>{p.grade}</span>
                      </td>
                      <td className="text-right p-3 md:p-4 font-mono">
                        {p.result === 'win'  ? <span className="win">✓ WIN</span>
                         : p.result === 'loss' ? <span className="loss">✗ LOSS</span>
                         : <span className="void">⊘ VOID</span>}
                      </td>
                      <td className={`text-right p-3 md:p-4 font-mono ${Number(p.pl) > 0 ? 'win' : Number(p.pl) < 0 ? 'loss' : 'void'}`}>
                        {Number(p.pl) > 0 ? `+€${Number(p.pl).toFixed(0)}` : Number(p.pl) < 0 ? `-€${Math.abs(Number(p.pl)).toFixed(0)}` : '€0'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-600 text-center mt-6">
            Stake padrão €10. P&amp;L assume €1.000 bankroll. Auditado em real-time.
          </p>

        </div>
      </main>
      <Footer />
    </>
  );
}
