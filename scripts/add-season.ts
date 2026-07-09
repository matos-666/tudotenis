/**
 * add-season.ts — adiciona um torneio à tabela live_seasons a partir de
 * um matchId da Sportradar, sem deploy.
 *
 * Fluxo para adicionar um torneio novo:
 *   1. Abrir o live-match-tracker da SR num jogo desse torneio (widget em
 *      qualquer site que o use, ex.: widgets.sir.sportradar.com/.../live-match-tracker).
 *   2. Copiar o matchId do URL: #matches:(matchId:XXXXX,sportId:5,...).
 *   3. Correr:  npx tsx scripts/add-season.ts <matchId> <slug> [--doubles] [--ends 2026-09-10]
 *
 * O season id é extraído do match_get (campo _seasonid) — NÃO confundir
 * com o uniqueTournamentId (utid) do URL do widget.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (do .env.local
 * localmente). O supabase client inicializa no import de @/lib/supabase,
 * por isso as funções vêm de import DINÂMICO depois do dotenv config
 * (mesmo padrão de scripts/poll-live.ts).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const SR_BASE = 'https://lmt.fn.sportradar.com/betradar/en/Etc:UTC/gismo';
const SR_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Referer': 'https://widgets.sir.sportradar.com/betradar/en/live-match-tracker',
  'Origin': 'https://widgets.sir.sportradar.com',
};

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let doubles = false;
  let ends: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--doubles') doubles = true;
    else if (a === '--ends') { ends = argv[++i] ?? null; }
    else positional.push(a);
  }
  return { matchId: positional[0], slug: positional[1], doubles, ends };
}

async function srGet(path: string): Promise<any | null> {
  try {
    const r = await fetch(`${SR_BASE}/${path}`, { headers: SR_HEADERS });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function main() {
  const { matchId, slug, doubles, ends } = parseArgs(process.argv.slice(2));
  if (!matchId || !slug) {
    console.error('Uso: npx tsx scripts/add-season.ts <matchId> <slug> [--doubles] [--ends YYYY-MM-DD]');
    process.exit(1);
  }

  // 1. match_get → _seasonid
  const mg = await srGet(`match_get/${matchId}`);
  const mdata = mg?.doc?.[0]?.data;
  const seasonId: number | undefined = mdata?._seasonid;
  const utid: number | undefined = mdata?._utid;
  if (!seasonId) {
    console.error(`match_get/${matchId} não devolveu _seasonid. Confirma o matchId e que o jogo é recente.`);
    console.error(`(dica: sem os headers Referer/Origin da SR o endpoint devolve vazio)`);
    process.exit(1);
  }
  console.log(`match ${matchId}: _seasonid=${seasonId} _utid=${utid}`);

  // 2. Validar fixtures não-vazios + mostrar exemplos para confirmação humana
  const fx = await srGet(`stats_season_fixtures2/${seasonId}/1`);
  const matches = fx?.doc?.[0]?.data?.matches ?? [];
  const arr = Array.isArray(matches) ? matches : Object.values(matches);
  if (arr.length === 0) {
    console.error(`season ${seasonId} sem fixtures — abortado.`);
    process.exit(1);
  }
  console.log(`season ${seasonId}: ${arr.length} fixtures. Exemplos:`);
  for (const m of arr.slice(0, 3) as any[]) {
    const h = m?.teams?.home?.name ?? '?';
    const a = m?.teams?.away?.name ?? '?';
    console.log(`  ${h} vs ${a}`);
  }

  // 3. tour do slug (mistas usam 'atp' por convenção do pace de serviço)
  const tour: 'atp' | 'wta' = /wta/i.test(slug) && !/mista/i.test(slug) ? 'wta' : 'atp';

  // 4. upsert (import dinâmico pós-dotenv)
  const { getServiceSupabase } = await import('@/lib/supabase');
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('live_seasons')
    .upsert({
      id: seasonId,
      tour,
      tournament_slug: slug,
      is_doubles: doubles,
      active: true,
      ends_at: ends,
    }, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('upsert falhou:', error.message);
    if (error.code === '42P01') console.error('(a tabela live_seasons ainda não existe — aplica a migração 20260707_live_seasons.sql no dashboard Supabase)');
    process.exit(1);
  }
  console.log('\n✓ live_seasons row:');
  console.log(JSON.stringify(data, null, 2));
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
