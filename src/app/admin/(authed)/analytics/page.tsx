export const dynamic = 'force-dynamic';

export default function AdminAnalyticsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold mb-1">Analytics</h1>
      <p className="text-sm text-gray-500 mb-6">Visitas, top pages, dispositivos.</p>
      <div className="stat-card p-6">
        <p className="text-sm mb-3">
          Para já, abre o dashboard oficial do Vercel:
        </p>
        <a
          href="https://vercel.com/matos-666s-projects/tudotenis/analytics"
          target="_blank"
          rel="noopener"
          className="inline-block px-4 py-2 rounded-lg bg-[var(--color-accent)] text-black font-semibold text-sm"
        >
          Abrir Vercel Analytics ↗
        </a>
        <p className="text-xs text-gray-500 mt-4">
          Em breve embeb-se aqui o resumo com top pages e visitas dos últimos 7 dias.
        </p>
      </div>
    </>
  );
}
