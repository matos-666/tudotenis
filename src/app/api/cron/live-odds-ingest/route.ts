/**
 * Endpoint Vercel para ingest de odds Twin — wrapper fino sobre
 * ingestTwinOdds (@/lib/live-odds-core), partilhado com o runner que
 * faz o polling contínuo sem consumir Vercel functions.
 * Mantido para trigger manual / fallback. Auth: Bearer CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ingestTwinOdds, type IngestPayload } from '@/lib/live-odds-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let payload: IngestPayload;
  try {
    payload = (await req.json()) as IngestPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const r = await ingestTwinOdds(payload);
  return NextResponse.json({ ok: true, ...r });
}
