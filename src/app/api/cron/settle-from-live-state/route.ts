/**
 * Endpoint Vercel para o settlement — wrapper fino sobre
 * settleFromLiveState (@/lib/settle-core), partilhado com o runner
 * GitHub Actions que chama o settle a cada ~5 min sem invocations
 * Vercel. Mantido para trigger manual / fallback (compatível com o
 * job cron-job.org, se existir). Auth: Bearer CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { settleFromLiveState } from '@/lib/settle-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const r = await settleFromLiveState();
  return NextResponse.json({ ok: true, ...r });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
