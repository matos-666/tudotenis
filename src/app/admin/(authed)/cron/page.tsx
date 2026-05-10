import { getServiceSupabase } from '@/lib/supabase';
import { CronControls } from './CronControls';

export const dynamic = 'force-dynamic';

interface LogRow {
  id: number;
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  message: string | null;
  details: Record<string, unknown> | null;
}

async function fetchLogs(): Promise<LogRow[]> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('cron_log')
      .select('id, job, started_at, finished_at, ok, message, details')
      .order('started_at', { ascending: false })
      .limit(50);
    if (error) {
      // Tabela ainda não existe — devolve [] e o template avisa o admin
      return [];
    }
    return (data ?? []) as LogRow[];
  } catch {
    return [];
  }
}

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-PT', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function durationMs(a: string, b: string | null) {
  if (!b) return null;
  return new Date(b).getTime() - new Date(a).getTime();
}

export default async function AdminCronPage() {
  const logs = await fetchLogs();

  return (
    <>
      <h1 className="text-2xl font-bold mb-1">Cron / Logs</h1>
      <p className="text-sm text-gray-500 mb-5">
        Disparar picks/settle manualmente e ver últimas 50 execuções.
      </p>

      <CronControls />

      <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3 mt-8">
        Últimas execuções
      </h2>

      {logs.length === 0 ? (
        <div className="stat-card p-5 text-sm text-gray-500">
          Sem logs ainda. Se a tabela <code className="text-xs bg-[var(--color-card)] px-1 rounded">cron_log</code> não
          existe, corre o SQL em <code className="text-xs bg-[var(--color-card)] px-1 rounded">supabase/migrations/20260510_cron_log.sql</code> no
          SQL Editor do Supabase.
        </div>
      ) : (
        <div className="stat-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface)] text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Job</th>
                <th className="text-left p-3">Início</th>
                <th className="text-left p-3">Duração</th>
                <th className="text-left p-3">Estado</th>
                <th className="text-left p-3">Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => {
                const dur = durationMs(l.started_at, l.finished_at);
                return (
                  <tr key={l.id} className="border-t border-[var(--color-border)] align-top">
                    <td className="p-3 whitespace-nowrap font-mono text-xs">{l.job}</td>
                    <td className="p-3 whitespace-nowrap text-xs">{fmt(l.started_at)}</td>
                    <td className="p-3 whitespace-nowrap text-xs font-mono">
                      {dur == null ? <span className="text-yellow-400">a correr…</span> : `${(dur / 1000).toFixed(1)}s`}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {l.ok === true && <span className="text-[var(--color-accent)]">✓ OK</span>}
                      {l.ok === false && <span className="text-red-400">✗ ERRO</span>}
                      {l.ok === null && <span className="text-yellow-400">…</span>}
                    </td>
                    <td className="p-3 text-xs">
                      <div className="max-w-[400px] truncate">{l.message ?? '—'}</div>
                      {l.details && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-500 text-[10px]">detalhes</summary>
                          <pre className="text-[10px] bg-[var(--color-card)] p-2 rounded mt-1 max-w-[500px] max-h-[300px] overflow-auto">
                            {JSON.stringify(l.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
