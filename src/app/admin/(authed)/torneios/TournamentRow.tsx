'use client';

import { useState, useTransition } from 'react';
import { updateTournament } from './actions';

interface Tournament {
  id: number;
  slug: string;
  name: string;
  year: number;
  tour: string;
  category: string | null;
  surface: string | null;
  flag: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  oddschecker_url: string | null;
}

const SURFACES = ['', 'hard', 'clay', 'grass', 'indoor', 'carpet'];
const CATEGORIES = ['', 'slam', '1000', '500', '250', 'finals', 'davis_cup', 'fed_cup', 'challenger', 'itf'];

export function TournamentRow({ t }: { t: Tournament }) {
  const [name, setName] = useState(t.name);
  const [surface, setSurface] = useState(t.surface ?? '');
  const [category, setCategory] = useState(t.category ?? '');
  const [flag, setFlag] = useState(t.flag ?? '');
  const [start, setStart] = useState(t.start_date ?? '');
  const [end, setEnd] = useState(t.end_date ?? '');
  const [oddscheckerUrl, setOddscheckerUrl] = useState(t.oddschecker_url ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const dirty =
    name !== t.name ||
    surface !== (t.surface ?? '') ||
    category !== (t.category ?? '') ||
    flag !== (t.flag ?? '') ||
    start !== (t.start_date ?? '') ||
    end !== (t.end_date ?? '') ||
    oddscheckerUrl !== (t.oddschecker_url ?? '');

  function save() {
    setStatus('saving');
    setErrMsg(null);
    startTransition(async () => {
      const res = await updateTournament(t.id, {
        name, surface, category, flag, start_date: start, end_date: end,
        oddschecker_url: oddscheckerUrl,
      });
      if (res.ok) {
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        setStatus('error');
        setErrMsg(res.error ?? 'Erro');
      }
    });
  }

  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="p-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-48 md:w-64 px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-sm"
        />
        <a href={`/torneios/${t.slug}`} target="_blank" rel="noopener" className="text-[10px] text-gray-500 hover:text-[var(--color-accent)] block mt-0.5">
          /{t.slug} ↗
        </a>
        <input
          type="url"
          value={oddscheckerUrl}
          onChange={e => setOddscheckerUrl(e.target.value)}
          placeholder="https://www.oddschecker.com/tennis/.../winner"
          className="w-48 md:w-64 mt-1 px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-[10px] font-mono"
          title="URL do Oddschecker para outrights (winner). Deixar vazio se não houver."
        />
      </td>
      <td className="p-2 text-xs uppercase">{t.tour} · {t.year}</td>
      <td className="p-2">
        <select value={category} onChange={e => setCategory(e.target.value)} className="px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-xs">
          {CATEGORIES.map(c => <option key={c} value={c}>{c || '—'}</option>)}
        </select>
      </td>
      <td className="p-2">
        <select value={surface} onChange={e => setSurface(e.target.value)} className="px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-xs">
          {SURFACES.map(s => <option key={s} value={s}>{s || '—'}</option>)}
        </select>
      </td>
      <td className="p-2">
        <input
          type="text"
          value={flag}
          onChange={e => setFlag(e.target.value)}
          placeholder="🇫🇷"
          className="w-12 px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-sm text-center"
        />
      </td>
      <td className="p-2">
        <input
          type="date"
          value={start}
          onChange={e => setStart(e.target.value)}
          className="px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-xs"
        />
      </td>
      <td className="p-2">
        <input
          type="date"
          value={end}
          onChange={e => setEnd(e.target.value)}
          className="px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-xs"
        />
      </td>
      <td className="p-2 whitespace-nowrap">
        <button
          onClick={save}
          disabled={!dirty || status === 'saving'}
          className="px-3 py-1 rounded bg-[var(--color-accent)] text-black text-xs font-semibold disabled:opacity-30"
        >
          {status === 'saving' ? '…' : status === 'saved' ? '✓' : 'Guardar'}
        </button>
        {status === 'error' && (
          <div className="text-xs text-red-400 mt-1 max-w-[120px]">{errMsg}</div>
        )}
      </td>
    </tr>
  );
}
