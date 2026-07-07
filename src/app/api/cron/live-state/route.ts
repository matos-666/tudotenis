/**
 * Endpoint Vercel para o poll live — wrapper fino sobre pollOnce
 * (a lógica vive em @/lib/live-poll, partilhada com o runner GitHub
 * Actions que faz o polling contínuo sem consumir Vercel functions).
 *
 * Mantido para trigger manual / fallback. Auth: Bearer CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pollOnce } from '@/lib/live-poll';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const t0 = Date.now();
  const r = await pollOnce();
  return NextResponse.json({ ok: true, ms: Date.now() - t0, ...r });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
