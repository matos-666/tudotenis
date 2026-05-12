'use client';

import { useState, useMemo } from 'react';
import {
  eloProb,
  fairOdds,
  bo3Distribution,
  bo5Distribution,
  matchProb,
  calculateEdge,
  displayElo,
} from '@/lib/elo';
import type { PredictorPlayer } from '@/app/ferramentas/predictor/page';

type Surface = 'hard' | 'clay' | 'grass';
type BoVal = 3 | 5;

const SURFACE_LABEL: Record<Surface, string> = {
  hard: 'Hard',
  clay: 'Terra batida',
  grass: 'Relvado',
};

// Prefer set-level ELO (treinado em outcomes de set, composição BO formula
// correcta). Fallback para match-level se set-level não está populado.
const SET_FIELD: Record<Surface, keyof PredictorPlayer> = {
  hard: 'elo_set_hard',
  clay: 'elo_set_clay',
  grass: 'elo_set_grass',
};
const MATCH_FIELD: Record<Surface, keyof PredictorPlayer> = {
  hard: 'elo_hard',
  clay: 'elo_clay',
  grass: 'elo_grass',
};

function eloFor(p: PredictorPlayer | undefined, surface: Surface): number {
  if (!p) return 1500;
  const setSurf = p[SET_FIELD[surface]] as number | null;
  if (setSurf != null) return setSurf;
  if (p.elo_set_overall != null) return p.elo_set_overall;
  const matchSurf = p[MATCH_FIELD[surface]] as number | null;
  return matchSurf ?? p.elo_overall ?? 1500;
}

function shortName(name: string): string {
  const parts = name.split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

export function Predictor({ players }: { players: PredictorPlayer[] }) {
  const [p1Name, setP1Name] = useState(players[0]?.name ?? '');
  const [p2Name, setP2Name] = useState(players[1]?.name ?? '');
  const [surface, setSurface] = useState<Surface>('hard');
  const [bo, setBo] = useState<BoVal>(3);
  const [houseOdd, setHouseOdd] = useState<string>('');

  // Look up players by name
  const p1 = useMemo(() => players.find(p => p.name === p1Name), [p1Name, players]);
  const p2 = useMemo(() => players.find(p => p.name === p2Name), [p2Name, players]);

  // Set-level ELO (Phase C): eloProb() devolve directamente set-prob.
  // Compomos para match-prob via fórmula BO3/BO5.
  const e1 = eloFor(p1, surface);
  const e2 = eloFor(p2, surface);

  const matchProbP1 = matchProb(e1, e2, bo);   // set-level + BO compose
  const matchProbP2 = 1 - matchProbP1;
  // Para Monte Carlo: set-prob raw (sem precisar inverter)
  const setProbP1 = eloProb(e1, e2);
  const fairP1 = fairOdds(matchProbP1);
  const fairP2 = fairOdds(matchProbP2);
  const favIsP1 = matchProbP1 >= 0.5;

  // Edge calculation
  const odd = parseFloat(houseOdd);
  const edge = !isNaN(odd) && odd > 1 ? calculateEdge(matchProbP1, odd) : null;

  // Monte Carlo distribution (analytical, equivalent to 10k simulations)
  const distribution = bo === 3 ? bo3Distribution(setProbP1) : bo5Distribution(setProbP1);
  const maxProb = Math.max(...distribution.map(d => d.prob));

  // Stats derived
  const probMultiSets = bo === 3
    ? distribution[1].prob + distribution[2].prob
    : distribution[1].prob + distribution[2].prob + distribution[3].prob + distribution[4].prob;

  const avgSets = bo === 3
    ? 2 + probMultiSets
    : 3 + (1 - distribution[0].prob - distribution[5].prob); // approx

  const avgGames = avgSets * 9; // ~9 games per set average
  const avgMins = avgSets * 38; // ~38 mins per set
  const hours = Math.floor(avgMins / 60);
  const mins = Math.round(avgMins % 60);

  const swapPlayers = () => {
    const tmp = p1Name;
    setP1Name(p2Name);
    setP2Name(tmp);
  };

  return (
    <>
      <datalist id="players-list">
        {players.map(p => (
          <option key={p.slug} value={p.name} />
        ))}
      </datalist>

      <div className="stat-card p-5 md:p-8 mb-6">
        <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 items-end mb-6">
          <div>
            <label className="text-xs uppercase text-gray-500 mb-2 block">Jogador 1</label>
            <input
              list="players-list"
              type="text"
              value={p1Name}
              onChange={e => setP1Name(e.target.value)}
              autoComplete="off"
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-base md:text-lg font-semibold focus:border-[var(--color-accent)] outline-none"
            />
            <div className="text-xs text-gray-500 mt-2">
              {p1 ? (
                <>
                  ELO: <span className="text-[var(--color-accent)] font-mono font-semibold">
                    {Math.round(displayElo(p1.elo_set_overall) ?? p1.elo_overall ?? 1500)}
                  </span>
                  {' · '}Hard {Math.round(displayElo(p1.elo_set_hard) ?? p1.elo_hard ?? 1500)} ·{' '}
                  Clay {Math.round(displayElo(p1.elo_set_clay) ?? p1.elo_clay ?? 1500)} ·{' '}
                  Grass {Math.round(displayElo(p1.elo_set_grass) ?? p1.elo_grass ?? 1500)}
                </>
              ) : (
                <span className="text-gray-600">Jogador não encontrado · escolhe da lista</span>
              )}
            </div>
          </div>

          <button
            onClick={swapPlayers}
            aria-label="Trocar jogadores"
            className="self-end mb-1 bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)] rounded-lg px-3 py-3 transition flex-shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 10h10M7 10l3-3M7 10l3 3M17 14H7M17 14l-3-3M17 14l-3 3" />
            </svg>
          </button>

          <div>
            <label className="text-xs uppercase text-gray-500 mb-2 block">Jogador 2</label>
            <input
              list="players-list"
              type="text"
              value={p2Name}
              onChange={e => setP2Name(e.target.value)}
              autoComplete="off"
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-base md:text-lg font-semibold focus:border-[var(--color-accent)] outline-none"
            />
            <div className="text-xs text-gray-500 mt-2">
              {p2 ? (
                <>
                  ELO: <span className="text-[var(--color-accent)] font-mono font-semibold">
                    {Math.round(displayElo(p2.elo_set_overall) ?? p2.elo_overall ?? 1500)}
                  </span>
                  {' · '}Hard {Math.round(displayElo(p2.elo_set_hard) ?? p2.elo_hard ?? 1500)} ·{' '}
                  Clay {Math.round(displayElo(p2.elo_set_clay) ?? p2.elo_clay ?? 1500)} ·{' '}
                  Grass {Math.round(displayElo(p2.elo_set_grass) ?? p2.elo_grass ?? 1500)}
                </>
              ) : (
                <span className="text-gray-600">Jogador não encontrado</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 mb-6">
          <div>
            <label className="text-xs uppercase text-gray-500 mb-2 block">Superfície</label>
            <select
              value={surface}
              onChange={e => setSurface(e.target.value as Surface)}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-3 focus:border-[var(--color-accent)] outline-none"
            >
              {Object.entries(SURFACE_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500 mb-2 block">Best of</label>
            <select
              value={bo}
              onChange={e => setBo(parseInt(e.target.value) as BoVal)}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-3 focus:border-[var(--color-accent)] outline-none"
            >
              <option value={3}>3 sets</option>
              <option value={5}>5 sets (Slam)</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500 mb-2 block">Quota Casa P1 (opcional)</label>
            <input
              type="number"
              step="0.01"
              placeholder="ex: 2.10"
              value={houseOdd}
              onChange={e => setHouseOdd(e.target.value)}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-3 focus:border-[var(--color-accent)] outline-none"
            />
          </div>
        </div>

        {/* Result */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 md:p-6">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-4">
            Previsão do modelo · {surface === 'clay' ? 'terra batida' : surface === 'grass' ? 'relvado' : surface} · best-of-{bo}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="text-right pr-3">
              <div className={`text-2xl md:text-3xl font-extrabold font-mono ${favIsP1 ? 'text-[var(--color-accent)]' : ''}`}>
                {Math.round(matchProbP1 * 100)}%
              </div>
              <div className={`text-sm ${favIsP1 ? '' : 'text-gray-400'}`}>
                {p1 ? shortName(p1.name) : '?'}
              </div>
            </div>
            <div className="text-left pl-3">
              <div className={`text-2xl md:text-3xl font-extrabold font-mono ${!favIsP1 ? 'text-[var(--color-accent)]' : ''}`}>
                {Math.round(matchProbP2 * 100)}%
              </div>
              <div className={`text-sm ${!favIsP1 ? '' : 'text-gray-400'}`}>
                {p2 ? shortName(p2.name) : '?'}
              </div>
            </div>
          </div>
          <div className="h-3 bg-[var(--color-border)] rounded-full overflow-hidden flex mb-5">
            <div
              className={favIsP1 ? 'bg-[var(--color-accent)]' : 'bg-gray-500'}
              style={{ width: `${matchProbP1 * 100}%` }}
            />
            <div className={`flex-1 ${!favIsP1 ? 'bg-[var(--color-accent)]' : 'bg-gray-500'}`} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm pt-4 border-t border-[var(--color-border)]">
            <div>
              <div className="text-xs text-gray-500 mb-1">Quota justa P1</div>
              <div className="font-mono font-bold text-base md:text-lg">{fairP1.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Quota justa P2</div>
              <div className="font-mono font-bold text-base md:text-lg">{fairP2.toFixed(2)}</div>
            </div>
            <div className="col-span-2 md:col-span-1">
              <div className="text-xs text-gray-500 mb-1">EV vs casa</div>
              <div className={`font-mono font-bold text-base md:text-lg ${
                edge == null ? 'text-gray-400' :
                edge >= 5  ? 'text-[var(--color-accent)]' :
                edge < 0   ? 'loss' : 'text-gray-400'
              }`}>
                {edge == null ? '—' : `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Monte Carlo */}
      <div className="stat-card p-5 md:p-6 mb-6">
        <h3 className="font-bold mb-1">Distribuição de scores · 10.000 simulações Monte Carlo</h3>
        <p className="text-xs text-gray-500 mb-6">Recalcula em tempo real quando mudas inputs</p>
        <div className={`grid gap-2 text-xs ${bo === 3 ? 'grid-cols-4' : 'grid-cols-3 md:grid-cols-6'}`}>
          {distribution.map(d => {
            const heightPct = Math.max(2, (d.prob / maxProb) * 100);
            return (
              <div key={d.label} className="text-center">
                <div className="h-24 bg-[var(--color-card)] rounded-t flex items-end">
                  <div
                    className={`w-full rounded-t ${d.favP1 === favIsP1 ? 'bg-[var(--color-accent)]' : 'bg-gray-600'}`}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <div className={`font-mono mt-1 ${d.favP1 === favIsP1 ? 'text-[var(--color-accent)]' : ''}`}>
                  {d.label}
                </div>
                <div className={d.favP1 === favIsP1 ? 'text-[var(--color-accent)]' : 'text-gray-500'}>
                  {(d.prob * 100).toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 pt-4 border-t border-[var(--color-border)] grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500">Tempo médio</div>
            <div className="font-mono font-bold">{hours}h {mins}m</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Total games esperados</div>
            <div className="font-mono font-bold">{avgGames.toFixed(1)}</div>
          </div>
          <div className="col-span-2 md:col-span-1">
            <div className="text-xs text-gray-500">P(jogo a {bo === 3 ? '3' : '4-5'} sets)</div>
            <div className="font-mono font-bold">{(probMultiSets * 100).toFixed(0)}%</div>
          </div>
        </div>
      </div>

      {/* CTA Kelly */}
      {edge != null && edge > 0 && (
        <div className="stat-card p-5 md:p-6 mb-6 border-[var(--color-accent)]/30">
          <div className="flex items-start gap-4">
            <div className="text-3xl">💰</div>
            <div className="flex-1">
              <h3 className="font-bold mb-1">Edge positivo detectado: +{edge.toFixed(1)}%</h3>
              <p className="text-sm text-gray-400 mb-3">
                Calcula o stake ótimo para esta aposta usando o critério de Kelly.
              </p>
              <a
                href={`/ferramentas/kelly?prob=${(matchProbP1 * 100).toFixed(1)}&odd=${odd}`}
                className="inline-block bg-[var(--color-accent)] text-[var(--color-surface)] px-4 py-2 rounded-lg font-semibold text-sm"
              >
                Abrir Calculadora Kelly →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
