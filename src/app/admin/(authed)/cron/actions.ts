'use server';

import { revalidatePath } from 'next/cache';
import { isAdminAuthed } from '@/lib/admin-auth';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tudotenis.com';

async function callCron(path: string): Promise<{ ok: boolean; status: number; body: string }> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, status: 0, body: 'CRON_SECRET missing' };

  try {
    const res = await fetch(`${SITE_URL}${path}?source=manual`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body: body.slice(0, 5000) };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

export async function runPicks(): Promise<{ ok: boolean; status: number; body: string }> {
  if (!(await isAdminAuthed())) return { ok: false, status: 401, body: 'unauthorized' };
  const r = await callCron('/api/cron/picks');
  revalidatePath('/admin/cron');
  revalidatePath('/picks');
  return r;
}

export async function runSettle(): Promise<{ ok: boolean; status: number; body: string }> {
  if (!(await isAdminAuthed())) return { ok: false, status: 401, body: 'unauthorized' };
  const r = await callCron('/api/cron/settle');
  revalidatePath('/admin/cron');
  revalidatePath('/picks');
  return r;
}
