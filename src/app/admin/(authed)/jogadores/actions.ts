'use server';

import { revalidatePath } from 'next/cache';
import { getServiceSupabase } from '@/lib/supabase';
import { isAdminAuthed } from '@/lib/admin-auth';

export type PlayerPatch = {
  photo_url?: string | null;
  name?: string;
  flag?: string | null;
  country?: string | null;
  atp_rank?: number | null;
  active?: boolean;
};

export async function updatePlayer(
  id: number,
  patch: PlayerPatch
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: 'unauthorized' };

  // Sanitize
  const clean: PlayerPatch = {};
  if (patch.photo_url !== undefined) {
    const url = (patch.photo_url ?? '').trim();
    clean.photo_url = url === '' ? null : url;
  }
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.flag !== undefined) clean.flag = (patch.flag ?? '').trim() || null;
  if (patch.country !== undefined) clean.country = (patch.country ?? '').trim() || null;
  if (patch.atp_rank !== undefined) {
    clean.atp_rank = patch.atp_rank == null ? null : Number(patch.atp_rank);
  }
  if (patch.active !== undefined) clean.active = !!patch.active;

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('players')
    .update(clean)
    .eq('id', id)
    .select('slug')
    .single();

  if (error) return { ok: false, error: error.message };

  // Revalidate ISR cache for the player profile + listing
  if (data?.slug) {
    revalidatePath(`/jogador/${data.slug}`);
  }
  revalidatePath('/jogadores');

  return { ok: true };
}
