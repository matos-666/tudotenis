/**
 * Helpers para registar execuções de cron jobs no Supabase.
 * A tabela `cron_log` precisa de existir (ver supabase/migrations/).
 */
import { getServiceSupabase } from './supabase';

export async function startCronLog(job: string, details?: Record<string, unknown>): Promise<number | null> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('cron_log')
      .insert({ job, details: details ?? null })
      .select('id')
      .single();
    if (error) {
      console.warn('[cron-log] start failed', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.warn('[cron-log] start exception', e);
    return null;
  }
}

export async function finishCronLog(
  id: number | null,
  ok: boolean,
  message: string,
  extraDetails?: Record<string, unknown>
): Promise<void> {
  if (id == null) return;
  try {
    const sb = getServiceSupabase();
    const patch: Record<string, unknown> = {
      finished_at: new Date().toISOString(),
      ok,
      message: message.slice(0, 2000),
    };
    if (extraDetails) {
      // Merge into existing details (fetch then write)
      const { data: cur } = await sb.from('cron_log').select('details').eq('id', id).single();
      patch.details = { ...(cur?.details ?? {}), ...extraDetails };
    }
    const { error } = await sb.from('cron_log').update(patch).eq('id', id);
    if (error) console.warn('[cron-log] finish failed', error.message);
  } catch (e) {
    console.warn('[cron-log] finish exception', e);
  }
}
