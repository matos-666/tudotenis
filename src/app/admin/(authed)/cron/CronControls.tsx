'use client';

import { useState, useTransition } from 'react';
import { runPicks, runSettle } from './actions';

export function CronControls() {
  const [output, setOutput] = useState<{ ok: boolean; status: number; body: string } | null>(null);
  const [pending, start] = useTransition();
  const [job, setJob] = useState<string | null>(null);

  function trigger(name: 'picks' | 'settle') {
    setOutput(null);
    setJob(name);
    start(async () => {
      const r = name === 'picks' ? await runPicks() : await runSettle();
      setOutput(r);
    });
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="stat-card p-5">
        <div className="font-semibold mb-1">Picks</div>
        <p className="text-xs text-gray-500 mb-3">
          Faz scrape do TennisStats e insere novos picks com edge ≥ 5%.
        </p>
        <button
          onClick={() => trigger('picks')}
          disabled={pending}
          className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-black font-semibold text-sm disabled:opacity-50"
        >
          {pending && job === 'picks' ? 'A correr…' : '▶ Correr Picks'}
        </button>
      </div>
      <div className="stat-card p-5">
        <div className="font-semibold mb-1">Settle</div>
        <p className="text-xs text-gray-500 mb-3">
          Verifica resultados dos picks pendentes nas últimas 48h e calcula P&amp;L.
        </p>
        <button
          onClick={() => trigger('settle')}
          disabled={pending}
          className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-black font-semibold text-sm disabled:opacity-50"
        >
          {pending && job === 'settle' ? 'A correr…' : '▶ Correr Settle'}
        </button>
      </div>

      {output && (
        <div className="sm:col-span-2 stat-card p-4">
          <div className="text-xs text-gray-500 mb-2">
            Status: <span className={output.ok ? 'text-[var(--color-accent)]' : 'text-red-400'}>
              {output.status} {output.ok ? 'OK' : 'ERRO'}
            </span>
          </div>
          <pre className="text-[10px] bg-[var(--color-card)] p-3 rounded max-h-[400px] overflow-auto whitespace-pre-wrap">
            {output.body}
          </pre>
        </div>
      )}
    </div>
  );
}
