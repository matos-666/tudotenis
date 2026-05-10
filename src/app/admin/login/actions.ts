'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, makeToken, verifyPassword } from '@/lib/admin-auth';

export async function loginAction(formData: FormData): Promise<{ error?: string }> {
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/admin');

  // Pequena defesa contra brute-force — não bloqueia, apenas atrasa
  await new Promise(r => setTimeout(r, 300));

  if (!verifyPassword(password)) {
    return { error: 'Password incorrecta.' };
  }

  const c = await cookies();
  c.set(ADMIN_COOKIE.name, makeToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_COOKIE.maxAge,
  });

  // Validate redirect target (prevent open redirect)
  const safeNext = next.startsWith('/admin') ? next : '/admin';
  redirect(safeNext);
}

export async function logoutAction() {
  const c = await cookies();
  c.delete(ADMIN_COOKIE.name);
  redirect('/admin/login');
}
