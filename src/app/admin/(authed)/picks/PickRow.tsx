'use client';

import { useState, useTransition } from 'react';
import { overridePickResult, type PickResult } from './actions';

interface PickItem {
  id: number;
  posted_at: string;
  scheduled_at: string | null;
  selection: string;
  market: string;
  odd: number;
  stake: number;
  edge_pct: number;
  grade: string;
  surface: string;
  p1_name: string | null;
  p2_name: string | null;
  tournament_name: string | null;
  result: 'win' | 'loss' | 'void' | null;
  pl: number | null;
  settled_at: string | null;
}

const RESULT_COLORS: Record<string, string> = {
  win: 'text-[var(--color-accent)]',
  loss: 'text-red-400',
  void: 'text-gray-500',
};

export function PickRow({ p }: { p: PickItem }) {
  const [result, setResult] = useState<PickResult>(p.result);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [, start] = useTransition();

  function setOverride(r: PickResult) {
    setStatus('saving');
    setErrMsg(null);
    start(async () => {
      const res = await overridePickResult(p.id, r);
      if (res.ok) {
        setResult(r);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 1500);
      } else {
        setStatus('error');
        setErrMsg(res.error ?? 'Erro');
      }
    });
  }

  // Recompute display PL based on current result selection
  const displayPL =
    result === 'win' ? p.stake * (p.odd - 1) :
    result === 'loss' ? -p.stake :
    result === 'void' ? 0 :
    null;

  return (
    <tr className="border-t border-[var(--color-border)] align-top">
      <td className="p-2 text-xs text-gray-500 whitespace-nowrap">
        {new Date(p.posted_at).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })}
      </td>
      <td className="p-2 max-w-[200px]">
        <div className="font-medium truncate">{p.selection}</div>
        <div className="text-[10px] text-gray-500 truncate">{p.market} · {p.tournament_name ?? ''}</div>
      </td>
      <td className="p-2 text-xs text-gray-400 max-w-[140px] truncate">
        {p.p1_name === p.selection ? p.p2_name : p.p1_name}
      </td>
      <td className="p-2 font-mono text-xs">{Number(p.odd).toFixed(2)}</td>
      <td className="p-2 font-mono text-xs text-[var(--color-accent)]">+{Number(p.edge_pct).toFixed(1)}%</td>
      <td className="p-2 text-xs font-bold">{p.grade}</td>
      <td className={`p-2 text-xs font-bold ${result ? RESULT_COLORS[result] : 'text-yellow-400'}`}>
        {result ? result.toUpperCase() : 'PENDING'}
      </td>
      <td className="p-2 text-xs font-mono">
        {displayPL == null ? '—' : `${displayPL >= 0 ? '+' : ''}€${displayPL.toFixed(2)}`}
      </td>
      <td className="p-2">
        <div className="flex gap-1">
          <button onClick={() => setOverride('win')} className="px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-xs font-bold">W</button>
          <button onClick={() => setOverride('loss')} className="px-2 py-1 rounded bg-[var(--color-card)] border border-red-500/30 hover:bg-red-500/10 text-red-400 text-xs font-bold">L</button>
          <button onClick={() => setOverride('void')} className="px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] hover:bg-[var(--color-border)]/50 text-gray-400 text-xs font-bold">V</button>
          <button onClick={() => setOverride(null)} className="px-2 py-1 rounded bg-[var(--color-card)] border border-yellow-500/30 hover:bg-yellow-500/10 text-yellow-400 text-xs">↺</button>
        </div>
        <div className="text-[10px] mt-1 h-3">
          {status === 'saving' && <span className="text-gray-500">a guardar…</span>}
          {status === 'saved' && <span className="text-[var(--color-accent)]">✓ guardado</span>}
          {status === 'error' && <span className="text-red-400">{errMsg}</span>}
        </div>
      </td>
    </tr>
  );
}
