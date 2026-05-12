import { getServiceSupabase } from '@/lib/supabase';
import { PickRow } from './PickRow';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

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

async function fetchPicks(opts: { filter: string; page: number }) {
  const sb = getServiceSupabase();
  let query = sb
    .from('picks')
    .select('id,posted_at,scheduled_at,selection,market,odd,stake,edge_pct,grade,surface,p1_name,p2_name,tournament_name,result,pl,settled_at',
      { count: 'exact' });

  if (opts.filter === 'pending') query = query.is('result', null);
  if (opts.filter === 'settled') query = query.not('result', 'is', null);
  if (opts.filter === 'wins') query = query.eq('result', 'win');
  if (opts.filter === 'losses') query = query.eq('result', 'loss');

  query = query.order('posted_at', { ascending: false });

  const from = (opts.page - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  return { picks: (data ?? []) as PickItem[], total: count ?? 0 };
}

export default async function AdminPicksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const filter = sp.filter ?? 'pending';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const { picks, total } = await fetchPicks({ filter, page });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tabs: Array<{ key: string; label: string }> = [
    { key: 'pending', label: 'Pendentes' },
    { key: 'settled', label: 'Settled' },
    { key: 'wins', label: 'Vitórias' },
    { key: 'losses', label: 'Derrotas' },
    { key: 'all', label: 'Todos' },
  ];

  return (
    <>
      <h1 className="text-2xl font-bold mb-1">Picks</h1>
      <p className="text-sm text-gray-500 mb-5">
        Override manual de resultado quando settler automático falha. {total} resultado(s).
      </p>

      <div className="flex gap-2 mb-5 flex-wrap">
        {tabs.map(t => (
          <a
            key={t.key}
            href={`?filter=${t.key}`}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
              filter === t.key
                ? 'bg-[var(--color-accent)] text-black font-semibold border-[var(--color-accent)]'
                : 'border-[var(--color-border)] text-gray-400 hover:border-[var(--color-accent)]/40'
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>

      <div className="stat-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)] text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Quando</th>
              <th className="text-left p-3">Pick</th>
              <th className="text-left p-3">vs</th>
              <th className="text-left p-3">Quota</th>
              <th className="text-left p-3">EV%</th>
              <th className="text-left p-3">Grade</th>
              <th className="text-left p-3">Resultado</th>
              <th className="text-left p-3">P&amp;L</th>
              <th className="p-3">Override</th>
            </tr>
          </thead>
          <tbody>
            {picks.map(p => <PickRow key={p.id} p={p} />)}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-5">
          {page > 1 && (
            <a href={`?filter=${filter}&page=${page - 1}`} className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm">
              ← Anterior
            </a>
          )}
          <span className="px-3 py-2 text-sm text-gray-500">{page} / {totalPages}</span>
          {page < totalPages && (
            <a href={`?filter=${filter}&page=${page + 1}`} className="px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-sm">
              Seguinte →
            </a>
          )}
        </div>
      )}
    </>
  );
}
