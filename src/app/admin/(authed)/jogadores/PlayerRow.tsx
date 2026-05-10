'use client';

import { useState, useTransition } from 'react';
import { updatePlayer } from './actions';

interface Player {
  id: number;
  slug: string;
  name: string;
  tour: string;
  country: string | null;
  flag: string | null;
  atp_rank: number | null;
  photo_url: string | null;
  active: boolean;
  elo_overall: number | null;
}

export function PlayerRow({ p }: { p: Player }) {
  const [photo, setPhoto] = useState(p.photo_url ?? '');
  const [flag, setFlag] = useState(p.flag ?? '');
  const [rank, setRank] = useState<string>(p.atp_rank?.toString() ?? '');
  const [active, setActive] = useState(p.active);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [, start] = useTransition();

  const dirty =
    photo !== (p.photo_url ?? '') ||
    flag !== (p.flag ?? '') ||
    rank !== (p.atp_rank?.toString() ?? '') ||
    active !== p.active;

  function save() {
    setStatus('saving');
    setErrMsg(null);
    start(async () => {
      const res = await updatePlayer(p.id, {
        photo_url: photo,
        flag,
        atp_rank: rank === '' ? null : parseInt(rank, 10),
        active,
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
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={p.name}
            className="w-12 h-12 rounded-lg object-cover bg-[var(--color-card)]"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
            }}
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-[var(--color-card)] border border-dashed border-[var(--color-border)] flex items-center justify-center text-xs text-gray-600">
            —
          </div>
        )}
      </td>
      <td className="p-2">
        <a href={`/jogador/${p.slug}`} target="_blank" rel="noopener" className="font-medium hover:text-[var(--color-accent)]">
          {p.name}
        </a>
        <div className="text-xs text-gray-500">{p.country ?? '—'}</div>
      </td>
      <td className="p-2 text-xs uppercase">{p.tour}</td>
      <td className="p-2">
        <input
          type="number"
          value={rank}
          onChange={e => setRank(e.target.value)}
          className="w-16 px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-sm"
        />
      </td>
      <td className="p-2 hidden md:table-cell text-xs font-mono">{p.elo_overall ?? '—'}</td>
      <td className="p-2">
        <input
          type="url"
          value={photo}
          onChange={e => setPhoto(e.target.value)}
          placeholder="https://…"
          className="w-64 md:w-80 px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-xs"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={flag}
          onChange={e => setFlag(e.target.value)}
          placeholder="🇮🇹"
          className="w-12 px-2 py-1 rounded bg-[var(--color-card)] border border-[var(--color-border)] text-sm text-center"
        />
      </td>
      <td className="p-2">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
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
