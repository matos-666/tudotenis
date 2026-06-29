'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { TournamentLite } from '@/app/torneios/page';
import { TennisBallIcon } from '@/components/icons';

// Indoor mapeado para hard — torneios indoor são quase sempre hard courts
// cobertos. Não temos UI dedicada à surface indoor.
const SURFACE_CLASS = {
  clay: 'surface-clay', hard: 'surface-hard',
  grass: 'surface-grass', indoor: 'surface-hard',
} as const;
function surfaceLabelLocal(locale: 'pt-PT' | 'pt-BR', surf: keyof typeof SURFACE_CLASS): string {
  if (surf === 'hard' || surf === 'indoor') return 'Hard';
  if (surf === 'clay')   return locale === 'pt-BR' ? 'Saibro'  : 'Terra batida';
  if (surf === 'grass')  return locale === 'pt-BR' ? 'Grama'   : 'Relvado';
  return surf;
}

const PT_MONTH = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const CATEGORIES = [
  { id: 'all',     label: 'Todos',         icon: '' },
  { id: 'slam',    label: 'Grand Slams',   icon: '' },
  { id: '1000',    label: 'Masters 1000',  icon: 'M' },
  { id: '500',     label: '500',           icon: '' },
  { id: '250',     label: '250',           icon: '' },
  { id: 'finals',  label: 'Finals',        icon: '★' },
] as const;

const TOURS = [
  { id: 'all', label: 'Todos' },
  { id: 'atp', label: 'ATP' },
  { id: 'wta', label: 'WTA' },
] as const;

export function TournamentsExplorer({ tournaments, locale = 'pt-PT' }: { tournaments: TournamentLite[]; locale?: 'pt-PT' | 'pt-BR' }) {
  const [cat,  setCat]  = useState<string>('all');
  const [tour, setTour] = useState<string>('all');
  const [year, setYear] = useState<number | 'all'>(new Date().getFullYear());

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const t of tournaments) if (t.year) set.add(t.year);
    return Array.from(set).sort((a, b) => b - a);
  }, [tournaments]);

  // Counts (com filtros aplicados excepto o do própria categoria)
  const filtered = useMemo(() => {
    return tournaments.filter(t => {
      if (cat !== 'all' && t.category !== cat) return false;
      if (tour !== 'all' && t.tour !== tour) return false;
      if (year !== 'all' && t.year !== year) return false;
      return true;
    });
  }, [tournaments, cat, tour, year]);

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    for (const t of tournaments) {
      if (tour !== 'all' && t.tour !== tour) continue;
      if (year !== 'all' && t.year !== year) continue;
      counts.all++;
      if (t.category) counts[t.category] = (counts[t.category] ?? 0) + 1;
    }
    return counts;
  }, [tournaments, tour, year]);

  // Group by month
  const grouped = useMemo(() => {
    const map = new Map<string, TournamentLite[]>();
    for (const t of filtered) {
      if (!t.start_date) continue;
      const d = new Date(t.start_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  return (
    <>
      {/* Tour filter */}
      <div className="flex gap-2 mb-3 text-xs flex-wrap">
        {TOURS.map(t => (
          <button
            key={t.id}
            onClick={() => setTour(t.id)}
            className={`px-3 py-2 rounded font-semibold transition ${
              tour === t.id
                ? 'bg-[var(--color-accent)] text-[var(--color-surface)]'
                : 'bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="mx-1 self-center text-gray-700">·</span>
        <select
          aria-label="Ano"
          value={String(year)}
          onChange={e => setYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
          className="bg-[var(--color-card)] border border-[var(--color-border)] rounded px-3 py-2 text-xs cursor-pointer"
        >
          <option value="all">Todos os anos</option>
          {years.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 mb-6 text-xs flex-wrap">
        {CATEGORIES.map(c => {
          const count = catCounts[c.id] ?? 0;
          const active = cat === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              disabled={count === 0 && c.id !== 'all'}
              className={`px-3 py-2 rounded font-semibold transition ${
                active
                  ? 'bg-[var(--color-accent)] text-[var(--color-surface)]'
                  : count === 0
                    ? 'bg-[var(--color-card)] border border-[var(--color-border)] opacity-40 cursor-not-allowed'
                    : 'bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
              }`}
            >
              {c.icon && <span className="mr-1">{c.icon}</span>}
              {c.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="stat-card p-8 text-center">
          <TennisBallIcon size={36} className="mx-auto mb-3 text-[var(--color-accent)]" />
          <div className="font-semibold mb-1">Nenhum torneio encontrado</div>
          <p className="text-xs text-gray-500">Tenta ajustar os filtros.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([key, items]) => {
            const [yr, monthNum] = key.split('-');
            const label = `${PT_MONTH[parseInt(monthNum) - 1]} ${yr}`;
            return (
              <div key={key}>
                <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-3">
                  {label} <span className="text-gray-700">· {items.length}</span>
                </h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map(t => <TournamentCard key={t.id} t={t} locale={locale} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function TournamentCard({ t, locale = 'pt-PT' }: { t: TournamentLite; locale?: 'pt-PT' | 'pt-BR' }) {
  const prefix = locale === 'pt-BR' ? '/br' : '';
  const isLive = t.status === 'live';
  const isUpcoming = t.status === 'scheduled';
  const surfClass = t.surface ? SURFACE_CLASS[t.surface as keyof typeof SURFACE_CLASS] : '';
  const surfLabel = t.surface ? surfaceLabelLocal(locale, t.surface as keyof typeof SURFACE_CLASS) : '';
  const start = t.start_date ? new Date(t.start_date) : null;
  const end   = t.end_date   ? new Date(t.end_date)   : null;
  const dateStr = start && end
    ? (start.getMonth() === end.getMonth()
        ? `${start.getDate()}-${end.getDate()} ${PT_MONTH[start.getMonth()].slice(0, 3)}`
        : `${start.getDate()} ${PT_MONTH[start.getMonth()].slice(0, 3)} → ${end.getDate()} ${PT_MONTH[end.getMonth()].slice(0, 3)}`)
    : '';

  const catLabel = ({
    slam:    'Grand Slam',
    '1000':  'M1000',
    '500':   '500',
    '250':   '250',
    finals:  'Finals',
  } as Record<string, string>)[t.category ?? ''] ?? t.category;

  return (
    <Link
      href={`${prefix}/torneios/${t.slug}`}
      className={`stat-card p-4 hover:border-[var(--color-accent)]/50 transition ${
        isLive ? 'border-[var(--color-accent)]' : isUpcoming ? 'border-blue-500/40' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-2xl flex-shrink-0">{t.flag ?? '🎾'}</span>
          <div className="min-w-0">
            <div className="font-semibold truncate text-sm">{t.name}</div>
            <div className="text-xs text-gray-500">{dateStr} · {t.year}</div>
          </div>
        </div>
        {isLive && (
          <span className="text-[10px] uppercase font-bold tracking-wider text-red-400 flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            LIVE
          </span>
        )}
        {isUpcoming && (
          <span className="text-[10px] uppercase font-bold tracking-wider text-blue-400 flex-shrink-0">
            PRÓXIMO
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {surfLabel && <span className={`surface-pill ${surfClass}`}>{surfLabel}</span>}
        <span className="text-xs text-gray-500">{catLabel} · {t.tour.toUpperCase()}</span>
      </div>
    </Link>
  );
}
