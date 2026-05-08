import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AffiliateButtons } from '@/components/AffiliateButtons';

export const metadata: Metadata = {
  title: 'Picks do dia · ELO + Edge · TudoTénis',
  description:
    'Picks de ténis publicados pelo modelo ELO TudoTénis. Yield comprovado +30,4% em 405 tips auditadas. Saibro, hard, grama. ATP, WTA e Challengers.',
  alternates: { canonical: '/picks' },
};

export const revalidate = 600; // 10 min

interface MockPick {
  tournament: string;
  round: string;
  surface: 'clay' | 'hard' | 'grass' | 'indoor';
  player: string;
  flag: string;
  opponent: string;
  oppFlag: string;
  market: string;
  odd: number;
  edge: number;
  grade: 'A' | 'B' | 'C';
  status: 'live' | 'scheduled' | 'finished';
  liveScore?: string;
  startTime?: string;
}

const TODAY: MockPick[] = [
  {
    tournament: 'ATP Roma',
    round: '2ª ronda',
    surface: 'clay',
    player: 'Jannik Sinner',
    flag: '🇮🇹',
    opponent: 'Mariano Navone',
    oppFlag: '🇦🇷',
    market: 'Vencedor',
    odd: 1.18,
    edge: 12.3,
    grade: 'A',
    status: 'live',
    liveScore: '1º set 4-3',
  },
  {
    tournament: 'ATP Roma',
    round: '2ª ronda',
    surface: 'clay',
    player: 'Lorenzo Musetti',
    flag: '🇮🇹',
    opponent: 'Sebastian Korda',
    oppFlag: '🇺🇸',
    market: 'Vencedor',
    odd: 1.65,
    edge: 8.7,
    grade: 'B',
    status: 'scheduled',
    startTime: '15:30',
  },
  {
    tournament: 'WTA Roma',
    round: '1ª ronda',
    surface: 'clay',
    player: 'Iga Swiatek',
    flag: '🇵🇱',
    opponent: 'Elina Avanesyan',
    oppFlag: '🇦🇲',
    market: 'Vencedora -3.5 games',
    odd: 1.91,
    edge: 15.1,
    grade: 'A',
    status: 'live',
    liveScore: '2º set 3-1',
  },
  {
    tournament: 'Challenger Cagliari',
    round: 'QF',
    surface: 'clay',
    player: 'Matteo Arnaldi',
    flag: '🇮🇹',
    opponent: 'Hubert Hurkacz',
    oppFlag: '🇵🇱',
    market: 'Vencedor',
    odd: 2.75,
    edge: 11.9,
    grade: 'A',
    status: 'scheduled',
    startTime: '17:00',
  },
  {
    tournament: 'ATP Roma',
    round: '2ª ronda',
    surface: 'clay',
    player: 'Luciano Darderi',
    flag: '🇮🇹',
    opponent: 'Alex de Minaur',
    oppFlag: '🇦🇺',
    market: 'Handicap +1.5 sets',
    odd: 1.55,
    edge: 6.4,
    grade: 'C',
    status: 'scheduled',
    startTime: '18:00',
  },
  {
    tournament: 'WTA Roma',
    round: '1ª ronda',
    surface: 'clay',
    player: 'Aryna Sabalenka',
    flag: '🇧🇾',
    opponent: 'Sara Errani',
    oppFlag: '🇮🇹',
    market: 'Vencedora',
    odd: 1.12,
    edge: 5.2,
    grade: 'B',
    status: 'scheduled',
    startTime: '19:30',
  },
];

const YESTERDAY: { player: string; flag: string; opponent: string; market: string; odd: number; result: 'win' | 'loss' | 'void'; pl: number; finalScore?: string }[] = [
  { player: 'Carlos Alcaraz', flag: '🇪🇸', opponent: 'Casper Ruud', market: 'Vencedor', odd: 2.05, result: 'win',  pl: 42, finalScore: '6-3, 6-2' },
  { player: 'Novak Djokovic', flag: '🇷🇸', opponent: 'Stefanos Tsitsipas', market: 'Vencedor', odd: 1.78, result: 'win', pl: 28, finalScore: '7-5, 6-4' },
  { player: 'Iga Swiatek', flag: '🇵🇱', opponent: 'Coco Gauff', market: '-1.5 sets', odd: 2.10, result: 'loss', pl: -25, finalScore: '3-6, 4-6' },
  { player: 'Sebastian Korda', flag: '🇺🇸', opponent: 'Hubert Hurkacz', market: 'Vencedor', odd: 2.45, result: 'win', pl: 67, finalScore: '6-4, 7-6' },
  { player: 'Taylor Fritz', flag: '🇺🇸', opponent: 'Lorenzo Musetti', market: 'Vencedor', odd: 1.95, result: 'win', pl: 18, finalScore: '6-4, 3-6, 6-3' },
  { player: 'Aryna Sabalenka', flag: '🇧🇾', opponent: 'Madison Keys', market: 'Over 21.5 games', odd: 1.85, result: 'loss', pl: -15, finalScore: '6-2, 4-6, 4-6' },
  { player: 'Arthur Fils', flag: '🇫🇷', opponent: 'Mariano Navone', market: 'Vencedor', odd: 2.20, result: 'win', pl: 52, finalScore: '7-6, 6-3' },
];

const SURFACE_CLASS = { clay: 'surface-clay', hard: 'surface-hard', grass: 'surface-grass', indoor: 'surface-indoor' } as const;
const SURFACE_LABEL = { clay: 'Saibro', hard: 'Hard', grass: 'Grama', indoor: 'Indoor' } as const;

function PickCard({ p }: { p: MockPick }) {
  const isLive = p.status === 'live';
  return (
    <div className={`stat-card p-5 ${isLive ? 'border-red-500/40 shadow-lg shadow-red-500/5' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <span className="text-xs text-gray-500">{p.tournament} · {p.round}</span>
        <div className="flex gap-2 items-center">
          <span className={`surface-pill ${SURFACE_CLASS[p.surface]}`}>{SURFACE_LABEL[p.surface]}</span>
          {isLive && (
            <span className="text-[10px] uppercase font-bold tracking-wider text-red-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              LIVE · {p.liveScore}
            </span>
          )}
          {p.status === 'scheduled' && (
            <span className="text-[10px] uppercase font-bold text-blue-400">⏱ {p.startTime}</span>
          )}
        </div>
      </div>

      {/* Players */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{p.player} <span className="text-gray-500 text-sm">{p.flag}</span></span>
        </div>
        <div className="text-xs text-gray-600 text-center">vs</div>
        <div className="flex items-center justify-between text-gray-400">
          <span>{p.opponent} <span className="text-gray-600 text-sm">{p.oppFlag}</span></span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-end justify-between pt-3 border-t border-[var(--color-border)] mb-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">Aposta</div>
          <div className="font-semibold text-sm">{p.market}</div>
          <div className="text-xs">@ <span className="text-[var(--color-accent)] font-mono font-semibold">{p.odd.toFixed(2)}</span></div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500 mb-1">Edge</div>
          <div className="font-bold text-[var(--color-accent)]">+{p.edge}%</div>
        </div>
        <span className={`grade-${p.grade} px-2 py-1 rounded text-xs font-bold`}>{p.grade}</span>
      </div>

      {/* CTAs */}
      <AffiliateButtons variant="compact" prefix="Apostar @" />
    </div>
  );
}

export default function PicksPage() {
  const liveCount = TODAY.filter(p => p.status === 'live').length;
  const pendingCount = TODAY.filter(p => p.status === 'scheduled').length;
  const ydayWins = YESTERDAY.filter(p => p.result === 'win').length;
  const ydayLosses = YESTERDAY.filter(p => p.result === 'loss').length;
  const ydayPL = YESTERDAY.reduce((sum, p) => sum + p.pl, 0);
  const ydayYield = YESTERDAY.length > 0
    ? (YESTERDAY.reduce((s, p) => s + p.pl, 0) / (YESTERDAY.length * 10)) * 100
    : 0;

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

            {/* Performance KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">Yield total</div>
                <div className="text-xl md:text-2xl font-extrabold text-[var(--color-accent)] font-mono">+30,4%</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">P&L (€1k bankroll)</div>
                <div className="text-xl md:text-2xl font-extrabold text-[var(--color-accent)] font-mono">+€8.788</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">Tips totais</div>
                <div className="text-xl md:text-2xl font-extrabold font-mono">405</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-gray-500 mb-1">Win rate</div>
                <div className="text-xl md:text-2xl font-extrabold font-mono">46,9%</div>
              </div>
            </div>
          </div>

          {/* Picks de hoje */}
          <h2 className="text-xl font-bold mb-4">Picks · {new Date().toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
            {TODAY.map((p, i) => <PickCard key={i} p={p} />)}
          </div>

          {/* Resultados de ontem */}
          <div className="border-t border-[var(--color-border)] pt-10 mb-10">
            <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-bold">Resultados · ontem</h2>
                <p className="text-xs text-gray-500 mt-1">Settled automaticamente via BetExplorer</p>
              </div>
              <div className="flex gap-4 text-sm">
                <div className="text-center">
                  <div className="text-xs text-gray-500">V-D</div>
                  <div className="font-bold"><span className="win">{ydayWins}</span>-<span className="loss">{ydayLosses}</span></div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500">Yield</div>
                  <div className="font-bold text-[var(--color-accent)]">{ydayYield >= 0 ? '+' : ''}{ydayYield.toFixed(1)}%</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500">P&L</div>
                  <div className={`font-bold ${ydayPL >= 0 ? 'text-[var(--color-accent)]' : 'loss'}`}>
                    {ydayPL >= 0 ? '+' : ''}€{ydayPL}
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
                    <th className="text-right p-3 md:p-4 font-medium">P&L</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {YESTERDAY.map((p, i) => (
                    <tr key={i} className="border-t border-[var(--color-border)]">
                      <td className="p-3 md:p-4 font-sans font-semibold">{p.player} <span className="text-gray-600 text-xs">{p.flag}</span></td>
                      <td className="hidden sm:table-cell p-4 font-sans text-gray-400">{p.opponent}</td>
                      <td className="p-3 md:p-4 font-sans text-xs">{p.market}</td>
                      <td className="text-right p-3 md:p-4">{p.odd.toFixed(2)}</td>
                      <td className="text-right p-3 md:p-4">
                        {p.result === 'win'  ? <span className="win">✓ WIN</span>
                          : p.result === 'loss' ? <span className="loss">✗ LOSS</span>
                          : <span className="void">⊘ VOID</span>}
                      </td>
                      <td className={`text-right p-3 md:p-4 ${p.pl > 0 ? 'win' : p.pl < 0 ? 'loss' : 'void'}`}>
                        {p.pl > 0 ? `+€${p.pl}` : p.pl < 0 ? `-€${Math.abs(p.pl)}` : '€0'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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
