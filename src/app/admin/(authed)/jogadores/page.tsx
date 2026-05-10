import { getServiceSupabase } from '@/lib/supabase';
import { PlayerRow } from './PlayerRow';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

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

async function fetchPlayers(opts: {
  q?: string;
  tour?: string;
  filter?: string;
  page: number;
}) {
  const sb = getServiceSupabase();
  let query = sb
    .from('players')
    .select('id,slug,name,tour,country,flag,atp_rank,photo_url,active,elo_overall', { count: 'exact' });

  if (opts.q) query = query.ilike('name', `%${opts.q}%`);
  if (opts.tour && opts.tour !== 'all') query = query.eq('tour', opts.tour);
  if (opts.filter === 'no-photo') query = query.is('photo_url', null);
  if (opts.filter === 'active') query = query.eq('active', true);

  // Order: active first, then by ATP rank (nulls last), then ELO desc
  query = query
    .order('active', { ascending: false })
    .order('atp_rank', { ascending: true, nullsFirst: false })
    .order('elo_overall', { ascending: false, nullsFirst: false });

  const from = (opts.page - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  return {
    players: (data ?? []) as Player[],
    total: count ?? 0,
  };
}

export default async function AdminPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tour?: string; filter?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const tour = sp.tour ?? 'all';
  const filter = sp.filter ?? 'all';
  const q = sp.q ?? '';

  const { players, total } = await fetchPlayers({ q, tour, filter, page });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1 className="text-2xl font-bold mb-1">Jogadores</h1>
      <p className="text-sm text-gray-500 mb-5">
        {total.toLocaleString('pt-PT')} resultado(s) · página {page}/{totalPages}
      </p>

      {/* Filters */}
      <form className="flex flex-wrap gap-2 mb-5 items-end" method="get">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-gray-500 block mb-1">Procurar nome</label>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Sinner, Świątek…"
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Tour</label>
          <select name="tour" defaultValue={tour} className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm">
            <option value="all">Todos</option>
            <option value="atp">ATP</option>
            <option value="wta">WTA</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Filtro</label>
          <select name="filter" defaultValue={filter} className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm">
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="no-photo">Sem foto</option>
          </select>
        </div>
        <button type="submit" className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-black font-semibold text-sm">
          Filtrar
        </button>
      </form>

      {/* Table */}
      <div className="stat-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)] text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Foto</th>
              <th className="text-left p-3">Jogador</th>
              <th className="text-left p-3">Tour</th>
              <th className="text-left p-3">Rank</th>
              <th className="text-left p-3 hidden md:table-cell">ELO</th>
              <th className="text-left p-3">URL foto</th>
              <th className="text-left p-3">Flag</th>
              <th className="text-left p-3">Activo</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {players.map(p => (
              <PlayerRow key={p.id} p={p} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-5">
          {page > 1 && (
            <a
              href={`?${new URLSearchParams({ q, tour, filter, page: String(page - 1) }).toString()}`}
              className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm"
            >
              ← Anterior
            </a>
          )}
          <span className="px-3 py-2 text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={`?${new URLSearchParams({ q, tour, filter, page: String(page + 1) }).toString()}`}
              className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm"
            >
              Seguinte →
            </a>
          )}
        </div>
      )}
    </>
  );
}
