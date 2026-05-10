import { getServiceSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function getRecentDataPoints() {
  // Picks como proxy de "actividade" — mostra atividade nos últimos 14 dias
  const sb = getServiceSupabase();
  const since = new Date(Date.now() - 14 * 24 * 3600e3).toISOString();
  const { data } = await sb
    .from('picks')
    .select('posted_at, result, pl')
    .gte('posted_at', since)
    .order('posted_at', { ascending: true });
  return data ?? [];
}

export default async function AdminAnalyticsPage() {
  const points = await getRecentDataPoints();

  // Aggregate by day
  const byDay = new Map<string, { picks: number; wins: number; pl: number }>();
  for (const p of points) {
    const day = (p.posted_at as string).slice(0, 10);
    const cur = byDay.get(day) ?? { picks: 0, wins: 0, pl: 0 };
    cur.picks++;
    if (p.result === 'win') cur.wins++;
    cur.pl += p.pl ?? 0;
    byDay.set(day, cur);
  }
  const rows = Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <>
      <h1 className="text-2xl font-bold mb-1">Analytics</h1>
      <p className="text-sm text-gray-500 mb-6">Visitas e actividade do site.</p>

      <div className="stat-card p-5 mb-6">
        <div className="font-semibold mb-2">Vercel Web Analytics</div>
        <p className="text-sm text-gray-500 mb-3">
          O package <code className="text-xs bg-[var(--color-card)] px-1 rounded">@vercel/analytics</code> já
          regista pageviews. Os primeiros dados aparecem ~30 min após primeiro acesso.
        </p>
        <a
          href="https://vercel.com/matos-666s-projects/tudotenis/analytics"
          target="_blank"
          rel="noopener"
          className="inline-block px-4 py-2 rounded-lg bg-[var(--color-accent)] text-black font-semibold text-sm"
        >
          Abrir Vercel Analytics ↗
        </a>
      </div>

      <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">
        Picks por dia · últimos 14 dias
      </h2>

      {rows.length === 0 ? (
        <div className="stat-card p-6 text-sm text-gray-500">Sem picks recentes.</div>
      ) : (
        <div className="stat-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface)] text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Dia</th>
                <th className="text-right p-3">Picks</th>
                <th className="text-right p-3">Vitórias</th>
                <th className="text-right p-3">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([day, s]) => (
                <tr key={day} className="border-t border-[var(--color-border)]">
                  <td className="p-3 font-mono text-xs">{day}</td>
                  <td className="p-3 text-right">{s.picks}</td>
                  <td className="p-3 text-right text-[var(--color-accent)]">{s.wins}</td>
                  <td className={`p-3 text-right font-mono ${s.pl >= 0 ? 'text-[var(--color-accent)]' : 'text-red-400'}`}>
                    {s.pl === 0 ? '—' : `${s.pl >= 0 ? '+' : ''}€${s.pl.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
