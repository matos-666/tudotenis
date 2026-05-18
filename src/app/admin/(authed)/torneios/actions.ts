'use server';

import { revalidatePath } from 'next/cache';
import { getServiceSupabase } from '@/lib/supabase';
import { isAdminAuthed } from '@/lib/admin-auth';

export type TournamentPatch = {
  name?: string;
  surface?: string | null;
  category?: string | null;
  flag?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  oddschecker_url?: string | null;
};

const ALLOWED_SURFACES = ['hard', 'clay', 'grass', 'indoor', 'carpet'];
const ALLOWED_CATEGORIES = ['slam', '1000', '500', '250', 'finals', 'davis_cup', 'fed_cup', 'challenger', 'itf'];

export async function updateTournament(
  id: number,
  patch: TournamentPatch
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: 'unauthorized' };

  const clean: Record<string, string | null | undefined> = {};
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.surface !== undefined) {
    const s = (patch.surface ?? '').trim().toLowerCase();
    clean.surface = s === '' ? null : (ALLOWED_SURFACES.includes(s) ? s : null);
    if (s && !ALLOWED_SURFACES.includes(s)) return { ok: false, error: `surface inválida: ${s}` };
  }
  if (patch.category !== undefined) {
    const c = (patch.category ?? '').trim().toLowerCase();
    clean.category = c === '' ? null : c;
    if (c && !ALLOWED_CATEGORIES.includes(c)) return { ok: false, error: `categoria inválida: ${c}` };
  }
  if (patch.flag !== undefined) clean.flag = (patch.flag ?? '').trim() || null;
  if (patch.start_date !== undefined) clean.start_date = patch.start_date || null;
  if (patch.end_date !== undefined) clean.end_date = patch.end_date || null;
  if (patch.status !== undefined) clean.status = patch.status || null;
  if (patch.oddschecker_url !== undefined) {
    const u = (patch.oddschecker_url ?? '').trim();
    if (u === '') {
      clean.oddschecker_url = null;
    } else if (!/^https:\/\/(www\.)?oddschecker\.com\//i.test(u)) {
      return { ok: false, error: 'URL tem de começar por https://www.oddschecker.com/' };
    } else {
      clean.oddschecker_url = u;
    }
  }

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('tournaments')
    .update(clean)
    .eq('id', id)
    .select('slug')
    .single();

  if (error) return { ok: false, error: error.message };

  if (data?.slug) revalidatePath(`/torneios/${data.slug}`);
  revalidatePath('/torneios');

  return { ok: true };
}
