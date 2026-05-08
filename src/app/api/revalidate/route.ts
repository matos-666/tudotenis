import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/revalidate?path=/picks&secret=<REVALIDATE_SECRET>
 * Usado pelo GitHub Actions após inserir picks novos.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const path   = searchParams.get('path') ?? '/picks';

  if (secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  revalidatePath(path);
  return NextResponse.json({ revalidated: true, path });
}
