'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { kellyFraction, calculateEdge } from '@/lib/elo';

export function KellyCalc() {
  const searchParams = useSearchParams();
  const [bankroll, setBankroll] = useState<string>('1000');
  const [odd, setOdd] = useState<string>('2.10');
  const [probPct, setProbPct] = useState<string>('55');
  const [fractionPct, setFractionPct] = useState<number>(25);

  // Auto-fill from query params (when coming from Predictor)
  useEffect(() => {
    const qProb = searchParams.get('prob');
    const qOdd = searchParams.get('odd');
    if (qProb) setProbPct(qProb);
    if (qOdd) setOdd(qOdd);
  }, [searchParams]);

  const result = useMemo(() => {
    const b = parseFloat(bankroll) || 0;
    const o = parseFloat(odd) || 0;
    const p = (parseFloat(probPct) || 0) / 100;
    const fraction = fractionPct / 100;

    const fullKelly = kellyFraction(p, o);
    const kellyApplied = Math.max(0, fullKelly * fraction);
    const stake = kellyApplied * b;
    const edge = o > 1 ? calculateEdge(p, o) : 0;
    const ev = stake * (p * (o - 1) - (1 - p));

    return { stake, kellyApplied, edge, ev, fullKelly };
  }, [bankroll, odd, probPct, fractionPct]);

  const fractionLabel = useMemo(() => {
    if (fractionPct === 25) return 'quarter Kelly · recomendado';
    if (fractionPct === 50) return 'half Kelly';
    if (fractionPct === 100) return 'full Kelly · agressivo';
    if (fractionPct < 25) return 'cauteloso';
    if (fractionPct < 50) return 'conservador';
    return 'agressivo';
  }, [fractionPct]);

  const verdict = useMemo(() => {
    if (result.edge >= 5) {
      return { text: '✓ Apostar', cls: 'text-[var(--color-accent)]' };
    }
    if (result.edge > 0) {
      return { text: '~ Marginal', cls: 'text-yellow-400' };
    }
    return { text: '✗ Não apostar', cls: 'loss' };
  }, [result.edge]);

  return (
    <>
      <div className="stat-card p-5 md:p-6 mb-6">
        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          <div>
            <label className="text-xs uppercase text-gray-500 mb-2 block">Bankroll (€)</label>
            <input
              type="number"
              value={bankroll}
              onChange={e => setBankroll(e.target.value)}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-3 font-mono focus:border-[var(--color-accent)] outline-none"
            />
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500 mb-2 block">Quota da casa</label>
            <input
              type="number"
              step="0.01"
              value={odd}
              onChange={e => setOdd(e.target.value)}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-3 font-mono focus:border-[var(--color-accent)] outline-none"
            />
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500 mb-2 block">Probabilidade modelo (%)</label>
            <input
              type="number"
              step="0.1"
              value={probPct}
              onChange={e => setProbPct(e.target.value)}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-3 font-mono focus:border-[var(--color-accent)] outline-none"
            />
          </div>
        </div>

        <div className="mb-5">
          <label className="text-xs uppercase text-gray-500 mb-2 flex justify-between flex-wrap gap-2">
            <span>Fração Kelly</span>
            <span className="text-[var(--color-accent)] font-mono normal-case">
              {fractionPct}% ({fractionLabel})
            </span>
          </label>
          <input
            type="range"
            min={10}
            max={100}
            value={fractionPct}
            onChange={e => setFractionPct(parseInt(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
          <div className="flex justify-between text-[10px] text-gray-500 mt-1">
            <span>10% (cauteloso)</span>
            <span>50% (half)</span>
            <span>100% (full · agressivo)</span>
          </div>
        </div>

        {/* Result panel */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-500 mb-1">Stake recomendado</div>
              <div className="text-xl md:text-2xl font-extrabold text-[var(--color-accent)] font-mono">
                €{result.stake.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">% bankroll</div>
              <div className="text-xl md:text-2xl font-extrabold font-mono">
                {(result.kellyApplied * 100).toFixed(2)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Edge</div>
              <div className={`text-xl md:text-2xl font-extrabold font-mono ${
                result.edge >= 5 ? 'text-[var(--color-accent)]' :
                result.edge < 0  ? 'loss' : ''
              }`}>
                {result.edge >= 0 ? '+' : ''}{result.edge.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Avaliação</div>
              <div className={`text-base md:text-lg font-extrabold ${verdict.cls}`}>
                {verdict.text}
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-[var(--color-border)] text-xs text-gray-500">
            {result.edge > 0 && result.stake > 0 ? (
              <>
                Ganho esperado por aposta:{' '}
                <span className="text-[var(--color-accent)] font-mono">
                  +€{result.ev.toFixed(2)}
                </span>
                {' · '}Em 100 apostas similares ganhavas em média €{(result.ev * 100).toFixed(0)}.
              </>
            ) : result.edge <= 0 ? (
              <span className="loss">Quota da casa demasiado baixa. Não há valor — passa esta aposta.</span>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
