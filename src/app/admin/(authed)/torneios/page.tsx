import { getServiceSupabase } from '@/lib/supabase';
import { TournamentRow } from './TournamentRow';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

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

async function fetchTournaments(opts: { q?: string; year?: string; tour?: string; page: number }) {
  const sb = getServiceSupabase();
  let query = sb
    .from('tournaments')
    .select('id,slug,name,year,tour,category,surface,flag,start_date,end_date,status,oddschecker_url', { count: 'exact' });

  if (opts.q) query = query.ilike('name', `%${opts.q}%`);
  if (opts.year && opts.year !== 'all') query = query.eq('year', parseInt(opts.year, 10));
  if (opts.tour && opts.tour !== 'all') query = query.eq('tour', opts.tour);

  query = query.order('start_date', { ascending: false, nullsFirst: false });

  const from = (opts.page - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  return { tournaments: (data ?? []) as Tournament[], total: count ?? 0 };
}

export default async function AdminTournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; year?: string; tour?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const year = sp.year ?? '2026';
  const tour = sp.tour ?? 'all';
  const q = sp.q ?? '';

  const { tournaments, total } = await fetchTournaments({ q, year, tour, page });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Years for dropdown
  const years = Array.from({ length: 12 }, (_, i) => 2026 - i);

  return (
    <>
      <h1 className="text-2xl font-bold mb-1">Torneios</h1>
      <p className="text-sm text-gray-500 mb-5">
        {total.toLocaleString('pt-PT')} resultado(s) · página {page}/{totalPages}
      </p>

      <form className="flex flex-wrap gap-2 mb-5 items-end" method="get">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-gray-500 block mb-1">Procurar nome</label>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Roland Garros, Indian Wells…"
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Ano</label>
          <select name="year" defaultValue={year} className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm">
            <option value="all">Todos</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Tour</label>
          <select name="tour" defaultValue={tour} className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm">
            <option value="all">Todos</option>
            <option value="atp">ATP</option>
            <option value="wta">WTA</option>
          </select>
        </div>
        <button type="submit" className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-black font-semibold text-sm">
          Filtrar
        </button>
      </form>

      <div className="stat-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)] text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Nome</th>
              <th className="text-left p-3">Tour</th>
              <th className="text-left p-3">Categoria</th>
              <th className="text-left p-3">Surface</th>
              <th className="text-left p-3">Flag</th>
              <th className="text-left p-3">Início</th>
              <th className="text-left p-3">Fim</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {tournaments.map(t => (
              <TournamentRow key={t.id} t={t} />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-5">
          {page > 1 && (
            <a
              href={`?${new URLSearchParams({ q, year, tour, page: String(page - 1) }).toString()}`}
              className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm"
            >← Anterior</a>
          )}
          <span className="px-3 py-2 text-sm text-gray-500">{page} / {totalPages}</span>
          {page < totalPages && (
            <a
              href={`?${new URLSearchParams({ q, year, tour, page: String(page + 1) }).toString()}`}
              className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm"
            >Seguinte →</a>
          )}
        </div>
      )}
    </>
  );
}
