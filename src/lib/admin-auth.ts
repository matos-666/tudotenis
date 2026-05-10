/**
 * Admin auth helpers.
 *
 * Mecanismo: cookie httpOnly assinado com HMAC-SHA256.
 * O cookie contém apenas timestamp de criação; verificação compara
 * assinatura e idade (1 semana).
 *
 * NUNCA usar em components client — só server (route handlers,
 * server actions, layout server components).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'tt-admin';
const MAX_AGE_S = 7 * 24 * 60 * 60; // 7 dias

function getSecret(): string {
  const s = process.env.ADMIN_COOKIE_SECRET;
  if (!s) throw new Error('ADMIN_COOKIE_SECRET missing');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

/**
 * Verifica password contra ADMIN_PASSWORD em env.
 * Constant-time compare.
 */
export function verifyPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Gera token assinado: "<timestamp>.<sig>"
 */
export function makeToken(): string {
  const ts = Date.now().toString();
  return `${ts}.${sign(ts)}`;
}

/**
 * Verifica token: assinatura válida e idade < MAX_AGE.
 */
export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [ts, sig] = token.split('.');
  if (!ts || !sig) return false;
  const expected = sign(ts);
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const age = (Date.now() - parseInt(ts, 10)) / 1000;
  return age >= 0 && age < MAX_AGE_S;
}

/**
 * Server-component / server-action helper para verificar sessão atual.
 */
export async function isAdminAuthed(): Promise<boolean> {
  const c = await cookies();
  return verifyToken(c.get(COOKIE_NAME)?.value);
}

export const ADMIN_COOKIE = {
  name: COOKIE_NAME,
  maxAge: MAX_AGE_S,
};
