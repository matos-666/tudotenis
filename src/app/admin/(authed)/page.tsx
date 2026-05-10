import Link from 'next/link';
import { getServiceSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function getStats() {
  const sb = getServiceSupabase();
  const [
    playersTotal,
    playersActive,
    playersWithPhoto,
    tournamentsTotal,
    tournaments2026,
    picksToday,
    picksUnsettled,
  ] = await Promise.all([
    sb.from('players').select('*', { count: 'exact', head: true }),
    sb.from('players').select('*', { count: 'exact', head: true }).eq('active', true),
    sb.from('players').select('*', { count: 'exact', head: true }).not('photo_url', 'is', null),
    sb.from('tournaments').select('*', { count: 'exact', head: true }),
    sb.from('tournaments').select('*', { count: 'exact', head: true }).eq('year', 2026),
    sb.from('picks').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 3600e3).toISOString()),
    sb.from('picks').select('*', { count: 'exact', head: true }).is('result', null),
  ]);

  return {
    playersTotal: playersTotal.count ?? 0,
    playersActive: playersActive.count ?? 0,
    playersWithPhoto: playersWithPhoto.count ?? 0,
    tournamentsTotal: tournamentsTotal.count ?? 0,
    tournaments2026: tournaments2026.count ?? 0,
    picksToday: picksToday.count ?? 0,
    picksUnsettled: picksUnsettled.count ?? 0,
  };
}

export default async function AdminDashboard() {
  const s = await getStats();

  const cards = [
    { label: 'Jogadores activos', value: s.playersActive.toLocaleString('pt-PT'), sub: `${s.playersTotal.toLocaleString('pt-PT')} total` },
    { label: 'Com foto', value: s.playersWithPhoto.toLocaleString('pt-PT'), sub: `${Math.round((s.playersWithPhoto / Math.max(s.playersTotal, 1)) * 100)}% do total` },
    { label: 'Torneios 2026', value: s.tournaments2026.toLocaleString('pt-PT'), sub: `${s.tournamentsTotal.toLocaleString('pt-PT')} histórico` },
    { label: 'Picks últimas 24h', value: s.picksToday.toString(), sub: `${s.picksUnsettled} pendentes` },
  ];

  return (
    <>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-sm text-gray-500 mb-6">Visão geral do estado da base de dados.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {cards.map(c => (
          <div key={c.label} className="stat-card p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</div>
            <div className="text-2xl font-bold mt-1">{c.value}</div>
            <div className="text-xs text-gray-600 mt-1">{c.sub}</div>
          </div>
        ))}
      </div>

      <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">Ações rápidas</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Link href="/admin/jogadores" className="stat-card p-4 hover:border-[var(--color-accent)]/40 transition">
          <div className="font-semibold">Editar jogadores</div>
          <div className="text-xs text-gray-500 mt-1">Fotos, ranking, flag, status</div>
        </Link>
        <Link href="/admin/torneios" className="stat-card p-4 hover:border-[var(--color-accent)]/40 transition">
          <div className="font-semibold">Editar torneios</div>
          <div className="text-xs text-gray-500 mt-1">Surface, categoria, datas, flag</div>
        </Link>
        <Link href="/admin/picks" className="stat-card p-4 hover:border-[var(--color-accent)]/40 transition">
          <div className="font-semibold">Override picks</div>
          <div className="text-xs text-gray-500 mt-1">Forçar resultado se settler falhou</div>
        </Link>
        <Link href="/admin/cron" className="stat-card p-4 hover:border-[var(--color-accent)]/40 transition">
          <div className="font-semibold">Correr cron manualmente</div>
          <div className="text-xs text-gray-500 mt-1">Picks / Settle + ver logs de erro</div>
        </Link>
        <Link href="/admin/analytics" className="stat-card p-4 hover:border-[var(--color-accent)]/40 transition">
          <div className="font-semibold">Estatísticas de acesso</div>
          <div className="text-xs text-gray-500 mt-1">Vercel Web Analytics</div>
        </Link>
      </div>
    </>
  );
}
