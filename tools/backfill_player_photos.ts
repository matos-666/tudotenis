/**
 * backfill_player_photos.ts
 *
 * Recolha 1× de fotos de jogadores em cascata de fontes, faz download
 * dos bytes e guarda em Supabase Storage (bucket 'player-photos').
 * Actualiza `players.photo_url` para o URL público permanente do
 * Storage — nunca mais depende de URL externo.
 *
 * Scope: top-N por rank ATP + top-N WTA + todos os jogadores que
 * apareceram em live_state nos últimos 30 dias (via player_a_id /
 * player_b_id). Cobertura tipicamente ~1000 jogadores.
 *
 * Cascade de fontes:
 *   1. Wikipedia (pageimages API por nome) — melhor coverage top-300
 *   2. Wikipedia (variantes: apenas apelido, acentuação removida)
 *   3. ATPtour.com search + scrape (para tour='atp')
 *   4. WTAtennis.com search + scrape (para tour='wta')
 *
 * Run: SUPABASE_SERVICE_ROLE_KEY=... npx tsx tools/backfill_player_photos.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://imcwzhvblvgjvkaljzdn.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const BUCKET = 'player-photos';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_DELAY_MS = 700;
const WIKI_BATCH_SIZE = 30;
const WIKI_BATCH_DELAY_MS = 2500; // strict rate limit da MediaWiki API

interface Player {
  id: number;
  name: string;
  slug: string | null;
  tour: 'atp' | 'wta' | null;
  atp_rank: number | null;
  photo_url: string | null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Sources ──────────────────────────────────────────────────────────────

// Batch lookup: até WIKI_BATCH_SIZE titles numa única query. Wikipedia
// responde com resolução automática de redirects e devolve thumbnail
// para cada. Reduce 40× o número de requests → menos throttle.
async function fetchWikipediaBatch(titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const chunks: string[][] = [];
  for (let i = 0; i < titles.length; i += WIKI_BATCH_SIZE) {
    chunks.push(titles.slice(i, i + WIKI_BATCH_SIZE));
  }
  for (const chunk of chunks) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(chunk.join('|'))}&prop=pageimages&pithumbsize=500&format=json&formatversion=2&redirects=1`;
    let retries = 5;
    while (retries > 0) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (r.status === 429 || r.status === 503) {
          await sleep(5000 + (5 - retries) * 3000);
          retries--;
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        const pages = d?.query?.pages ?? [];
        const redirects: Array<{ from: string; to: string }> = d?.query?.redirects ?? [];
        const normalized: Array<{ from: string; to: string }> = d?.query?.normalized ?? [];
        // Build reverse map: canonical title → original input
        const inputByTitle = new Map<string, string>();
        for (const t of chunk) inputByTitle.set(t, t);
        for (const n of normalized) inputByTitle.set(n.to, inputByTitle.get(n.from) ?? n.from);
        for (const rd of redirects) inputByTitle.set(rd.to, inputByTitle.get(rd.from) ?? rd.from);
        for (const p of pages) {
          if (p.missing) continue;
          const orig = inputByTitle.get(p.title) ?? p.title;
          const src = p.thumbnail?.source;
          if (typeof src === 'string') out.set(orig, src);
        }
        break;
      } catch (e) {
        retries--;
        if (retries === 0) console.warn(`wiki batch failed: ${(e as Error).message}`);
        await sleep(2000);
      }
    }
    await sleep(WIKI_BATCH_DELAY_MS);
  }
  return out;
}

// ATP: search endpoint returns HTML with player links. Player page has
// <img class="player_headshot"> with src pointing to headshot.
async function tryATP(name: string): Promise<string | null> {
  try {
    const search = `https://www.atptour.com/en/-/ajax/wpplayer/getplayerlist?query=${encodeURIComponent(name)}&count=1`;
    const r = await fetch(search, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const html = await r.text();
    // Extract head-shot URL directly from response
    const match = html.match(/https?:\/\/[^"']+head-shot[^"']+\.(?:png|jpg|jpeg)/i);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

async function tryWTA(name: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(name);
    const r = await fetch(`https://www.wtatennis.com/search?query=${q}`, {
      headers: { 'User-Agent': UA },
    });
    if (!r.ok) return null;
    const html = await r.text();
    const match = html.match(/https?:\/\/[^"']*wtatennis[^"']*(?:player|headshot)[^"']*\.(?:png|jpg|jpeg|webp)/i);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

async function resolvePhotoFallback(p: Player): Promise<string | null> {
  if (p.tour === 'atp') return await tryATP(p.name);
  if (p.tour === 'wta') return await tryWTA(p.name);
  return null;
}

// ── Download + upload ────────────────────────────────────────────────────

async function downloadImage(url: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': 'https://en.wikipedia.org/',
        },
      });
      if (!r.ok) {
        if (r.status === 429 || r.status === 503) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        return null;
      }
      const contentType = r.headers.get('content-type') ?? 'image/jpeg';
      if (!contentType.startsWith('image/')) return null;
      const bytes = await r.arrayBuffer();
      if (bytes.byteLength < 500) return null;
      return { bytes, contentType };
    } catch {
      await sleep(1000);
    }
  }
  return null;
}

function extensionFromContentType(ct: string): string {
  if (ct.includes('png'))  return 'png';
  if (ct.includes('webp')) return 'webp';
  return 'jpg';
}

async function uploadToStorage(id: number, bytes: ArrayBuffer, contentType: string): Promise<string | null> {
  const ext = extensionFromContentType(contentType);
  const path = `${id}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) {
    console.warn(`   ↳ upload err: ${error.message}`);
    return null;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function updatePlayerPhoto(id: number, url: string): Promise<void> {
  const { error } = await supabase.from('players').update({ photo_url: url }).eq('id', id);
  if (error) console.warn(`   ↳ db update err: ${error.message}`);
}

// ── Scope ────────────────────────────────────────────────────────────────

async function fetchScope(): Promise<Player[]> {
  // Priority 1: player IDs vistos em live_state últimos 30 dias
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: liveRows } = await supabase
    .from('live_state')
    .select('player_a_id, player_b_id')
    .gt('captured_at', since);
  const liveIds = new Set<number>();
  for (const r of liveRows ?? []) {
    if (r.player_a_id) liveIds.add(r.player_a_id);
    if (r.player_b_id) liveIds.add(r.player_b_id);
  }
  console.log(`live_state últimos 30d: ${liveIds.size} jogadores únicos`);

  // Priority 2: top 300 ATP + top 300 WTA por rank
  const { data: topAtp } = await supabase
    .from('players')
    .select('id, name, slug, tour, atp_rank, photo_url')
    .eq('tour', 'atp')
    .not('atp_rank', 'is', null)
    .lte('atp_rank', 300)
    .order('atp_rank', { ascending: true });
  const { data: topWta } = await supabase
    .from('players')
    .select('id, name, slug, tour, atp_rank, photo_url')
    .eq('tour', 'wta')
    .not('atp_rank', 'is', null) // schema usa atp_rank para ambos
    .lte('atp_rank', 300)
    .order('atp_rank', { ascending: true });

  const priorityIds = new Set<number>([
    ...liveIds,
    ...(topAtp ?? []).map(p => p.id as number),
    ...(topWta ?? []).map(p => p.id as number),
  ]);

  // Fetch all in scope
  const idsArr = [...priorityIds];
  const chunks: Player[] = [];
  const CHUNK = 500;
  for (let i = 0; i < idsArr.length; i += CHUNK) {
    const { data } = await supabase
      .from('players')
      .select('id, name, slug, tour, atp_rank, photo_url')
      .in('id', idsArr.slice(i, i + CHUNK));
    chunks.push(...((data ?? []) as Player[]));
  }
  console.log(`Scope total: ${chunks.length} jogadores`);
  return chunks;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const players = await fetchScope();
  const skipHavingStorageUrl = process.env.RESET !== '1';
  const targets = players.filter(p => {
    if (!skipHavingStorageUrl) return true;
    // Já tem URL do Storage? skip (idempotente)
    return !(p.photo_url?.includes(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`));
  });
  const LIMIT = parseInt(process.env.LIMIT || '0', 10);
  if (LIMIT > 0) targets.length = Math.min(targets.length, LIMIT);
  console.log(`A processar: ${targets.length} (RESET=${process.env.RESET === '1' ? 'sim' : 'não'})`);

  // Fase 1 — Batch Wikipedia (uma passagem, 40 titles/request)
  console.log('\n[fase 1] Wikipedia batch lookup...');
  const nameToPlayer = new Map<string, Player>();
  const titlesToLookup: string[] = [];
  for (const p of targets) {
    const variants = new Set([p.name, `${p.name} (tennis)`, stripAccents(p.name)]);
    for (const v of variants) {
      titlesToLookup.push(v);
      nameToPlayer.set(v, p);
    }
  }
  const wikiHits = await fetchWikipediaBatch(titlesToLookup);
  const foundByPlayer = new Map<number, string>();
  for (const [title, url] of wikiHits) {
    const player = nameToPlayer.get(title);
    if (player && !foundByPlayer.has(player.id)) foundByPlayer.set(player.id, url);
  }
  console.log(`  Wikipedia URLs encontradas: ${foundByPlayer.size} / ${targets.length}`);

  // Fase 2 — Download + upload em série (rate-friendly para Wikimedia CDN)
  console.log('\n[fase 2] Download + upload...');
  const stats = { ok: 0, miss: 0, fail: 0, viaWiki: 0, viaATP: 0, viaWTA: 0 };
  let i = 0;
  for (const p of targets) {
    i++;
    process.stdout.write(`[${i}/${targets.length}] #${p.id} ${p.name.padEnd(35).slice(0, 35)} `);
    let foundUrl = foundByPlayer.get(p.id) ?? null;
    let source: 'wiki' | 'atp' | 'wta' = 'wiki';
    if (!foundUrl) {
      const fb = await resolvePhotoFallback(p);
      if (fb) {
        foundUrl = fb;
        source = p.tour === 'wta' ? 'wta' : 'atp';
      }
    }
    if (!foundUrl) {
      console.log('MISS');
      stats.miss++;
      continue;
    }
    const img = await downloadImage(foundUrl);
    if (!img) {
      console.log('DOWNLOAD_FAIL');
      stats.fail++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    const publicUrl = await uploadToStorage(p.id, img.bytes, img.contentType);
    if (!publicUrl) {
      console.log('UPLOAD_FAIL');
      stats.fail++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    await updatePlayerPhoto(p.id, publicUrl);
    console.log(`OK (${(img.bytes.byteLength / 1024).toFixed(0)}KB, ${source})`);
    stats.ok++;
    if (source === 'wiki') stats.viaWiki++;
    else if (source === 'atp')  stats.viaATP++;
    else if (source === 'wta')  stats.viaWTA++;
    await sleep(REQUEST_DELAY_MS);
  }

  console.log('\n═══ Summary ═══');
  console.log(`OK:      ${stats.ok}  (wiki=${stats.viaWiki} atp=${stats.viaATP} wta=${stats.viaWTA})`);
  console.log(`MISS:    ${stats.miss}`);
  console.log(`FAIL:    ${stats.fail}`);
  console.log(`Coverage real: ${((stats.ok / targets.length) * 100).toFixed(1)}%`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
