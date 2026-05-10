'use server';

import { revalidatePath } from 'next/cache';
import { getServiceSupabase } from '@/lib/supabase';
import { isAdminAuthed } from '@/lib/admin-auth';

export type PickResult = 'win' | 'loss' | 'void' | null;

function calcPL(result: PickResult, odd: number, stake: number): number {
  if (result === 'win') return stake * (odd - 1);
  if (result === 'loss') return -stake;
  return 0; // void or null
}

export async function overridePickResult(
  id: number,
  result: PickResult
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: 'unauthorized' };

  const sb = getServiceSupabase();

  // Need odd + stake to recompute P&L
  const { data: pick, error: fetchErr } = await sb
    .from('picks')
    .select('id, odd, stake')
    .eq('id', id)
    .single();
  if (fetchErr || !pick) return { ok: false, error: fetchErr?.message ?? 'not found' };

  const pl = calcPL(result, pick.odd, pick.stake);

  const { error } = await sb
    .from('picks')
    .update({
      result,
      pl: result == null ? null : pl,
      settled_at: result == null ? null : new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/picks');
  revalidatePath('/historico');
  return { ok: true };
}
