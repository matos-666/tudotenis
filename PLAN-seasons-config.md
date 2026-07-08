# PLAN: Seasons configuráveis via DB (o live não pode morrer com o fim de Wimbledon)

## Objectivo

Hoje os torneios monitorizados estão **hardcoded** em `ACTIVE_SEASONS`
(`src/lib/live-poll.ts`, grep `const ACTIVE_SEASONS`): 5 entradas de
Wimbledon 2026 (singles ATP/WTA + 3 de duplas). **Quando Wimbledon acabar
(~13-14 Jul), o polling deixa de encontrar matches e o site fica sem live
até alguém editar código e fazer deploy.** Mover a config para uma tabela
Supabase + criar uma ferramenta que adiciona torneios novos a partir de um
matchId da Sportradar (o processo manual que já usámos 2× nesta sessão,
automatizado).

## Ficheiros a tocar

1. `supabase/migrations/20260707_live_seasons.sql` (novo)
2. `src/lib/live-poll.ts` (ler seasons da DB com fallback ao hardcoded)
3. `scripts/add-season.ts` (novo — descoberta a partir de um matchId)

## Passos, por ordem

### Passo 1 — Migração da tabela

Criar `supabase/migrations/20260707_live_seasons.sql`:

```sql
create table if not exists live_seasons (
  id              bigint primary key,          -- SR season id (ex.: 132572)
  tour            text not null check (tour in ('atp', 'wta')),
  tournament_slug text not null,               -- ex.: 'us-open-2026-atp'
  is_doubles      boolean not null default false,
  active          boolean not null default true,
  starts_at       date,
  ends_at         date,                        -- desactivar auto após esta data
  created_at      timestamptz default now() not null
);

alter table live_seasons enable row level security;
create policy "public read live_seasons" on live_seasons for select using (true);

-- Seed com o estado actual (Wimbledon 2026)
insert into live_seasons (id, tour, tournament_slug, is_doubles, ends_at) values
  (132572, 'atp', 'wimbledon-2026-atp',           false, '2026-07-15'),
  (132536, 'wta', 'wimbledon-2026-wta',           false, '2026-07-15'),
  (136808, 'atp', 'wimbledon-2026-duplas-atp',    true,  '2026-07-15'),
  (136814, 'wta', 'wimbledon-2026-duplas-wta',    true,  '2026-07-15'),
  (136820, 'atp', 'wimbledon-2026-duplas-mistas', true,  '2026-07-15')
on conflict (id) do nothing;
```

**IMPORTANTE — como aplicar**: o utilizador aplica migrações colando o SQL
no **SQL Editor do dashboard Supabase** (não há pipeline de migração
automática; foi assim que a `doubles_picks` foi criada). Escrever o
ficheiro, commitar, e PEDIR ao utilizador para colar o conteúdo no
dashboard. Não assumir que foi aplicado — o Passo 2 tem de ser seguro
antes da migração existir.

### Passo 2 — `live-poll.ts` lê da DB com fallback

Em `src/lib/live-poll.ts`:

2a. Renomear o array actual para `FALLBACK_SEASONS` (manter conteúdo).

2b. Adicionar um loader com cache em módulo (o poll corre a cada 30s no
runner — 1 query por ciclo é aceitável, mas cachear 5 min é melhor):

```ts
type SeasonCfg = { id: number; tour: 'atp' | 'wta'; tournamentSlug: string; isDoubles: boolean };
let seasonsCache: { at: number; data: SeasonCfg[] } | null = null;

async function getActiveSeasons(): Promise<SeasonCfg[]> {
  if (seasonsCache && Date.now() - seasonsCache.at < 5 * 60_000) return seasonsCache.data;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('live_seasons')
      .select('id, tour, tournament_slug, is_doubles, active, ends_at')
      .eq('active', true);
    if (error || !data || data.length === 0) return FALLBACK_SEASONS;
    const rows = data
      .filter(r => r.ends_at == null || r.ends_at >= today)
      .map(r => ({
        id: r.id as number,
        tour: r.tour as 'atp' | 'wta',
        tournamentSlug: r.tournament_slug as string,
        isDoubles: r.is_doubles as boolean,
      }));
    if (rows.length === 0) return FALLBACK_SEASONS;
    seasonsCache = { at: Date.now(), data: rows };
    return rows;
  } catch {
    return FALLBACK_SEASONS;
  }
}
```

2c. Em `pollOnce` (grep `export async function pollOnce`), substituir o uso
directo de `ACTIVE_SEASONS` por `const seasons = await getActiveSeasons();`
e usar `seasons` no `Promise.all` e no interleaving.

2d. **Tipagem**: `processMatch(m, season)` usa
`typeof ACTIVE_SEASONS[number]` como tipo do parâmetro (grep
`season: typeof ACTIVE_SEASONS`). Trocar esse tipo por `SeasonCfg` — se
ficar `typeof FALLBACK_SEASONS[number]` compila mas quebra quando a DB
devolver rows (shape igual mas TS pode reclamar de literal types).

### Passo 3 — `scripts/add-season.ts`

Automatizar o processo manual (extração de seasonid via `match_get`):

```
Uso: npx tsx scripts/add-season.ts <matchId> <slug> [--doubles] [--ends 2026-09-10]
```

O script:
1. Carrega `.env.local` via dotenv (ver `scripts/poll-live.ts` — usar o
   MESMO padrão de dynamic import pós-config, senão o supabase client
   inicializa sem env).
2. Chama `https://lmt.fn.sportradar.com/betradar/en/Etc:UTC/gismo/match_get/{matchId}`
   com headers `User-Agent: Mozilla/5.0`,
   `Referer: https://widgets.sir.sportradar.com/betradar/en/live-match-tracker`,
   `Origin: https://widgets.sir.sportradar.com` (SEM estes headers a SR
   devolve vazio — confirmado nesta sessão).
3. Extrai `doc[0].data._seasonid` e `_utid`. Se `_seasonid` ausente, abort
   com mensagem clara.
4. Valida com `stats_season_fixtures2/{seasonid}/1` que devolve `matches`
   não-vazio; imprime 2 exemplos de nomes para o humano confirmar o torneio.
5. Infere `tour`: se o slug contém 'wta' → 'wta', senão 'atp' (mistas usam
   'atp' — convenção já usada no ACTIVE_SEASONS actual).
6. `upsert` em `live_seasons` e imprime a row final.

### Passo 4 — Documentar o fluxo no README ou no topo do script

"Para adicionar um torneio novo: abrir o live-match-tracker da SR num jogo
desse torneio (via widget em qualquer site que o use), copiar o matchId do
URL (`#matches:(matchId:XXXXX,...)`), correr o script. Sem deploy."

### Passo 5 — Typecheck + teste + commit

```bash
npx tsc --noEmit -p .
# teste do loader com fallback (antes da migração aplicada — deve cair no fallback):
npx tsx -e "import('dotenv').then(d=>{d.config({path:'.env.local'});import('./src/lib/live-poll').then(async m=>console.log('ok'))})"
git add -A && git commit && git push
```

## Edge cases (não saltar)

1. **Migração ainda não aplicada** quando o código for a deploy: a query à
   `live_seasons` devolve erro `42P01` (relation does not exist) — o
   try/catch + fallback cobre isso. TESTAR este caminho antes de pedir a
   migração ao utilizador.
2. **Cache do módulo no runner**: o runner corre 5.5h — com cache de 5 min,
   adicionar um torneio a meio da sessão entra em ≤5 min. Não cachear
   "para sempre".
3. **`ends_at` é date, não timestamptz**: comparar com `YYYY-MM-DD` string,
   não com ISO completo.
4. **utid ≠ seasonid**: o URL do widget tem `uniqueTournamentId` (utid) —
   NÃO é o season id. O season id só vem do `match_get` (campo
   `_seasonid`). Confundir os dois foi um erro quase cometido nesta sessão.
5. **BO5 vs BO3**: `processMatch` decide bestOf com
   `season.tour === 'atp' && !season.isDoubles && slug.includes('wimbledon')`.
   Para o US Open (também BO5 masculino) o slug tem de continuar a permitir
   esta inferência → generalizar a condição para
   `GRAND_SLAM_RE = /wimbledon|us-open|roland-garros|australian-open/` no
   mesmo passo, senão o US Open masculino corre como BO3 e o modelo erra.
6. **Slug de duplas**: manter a convenção `...-duplas-{atp|wta|mistas}` —
   `surfaceFromSlug`/`formatTournamentName` na UI e a detecção `mistas` em
   `processMatch` dependem de substrings do slug.

## Critérios de aceitação

1. `npx tsc --noEmit` limpo.
2. Com a tabela ainda por criar: `pollOnce` continua a funcionar
   (fallback) — testável correndo `POLL_RUNTIME_MS=35000 npx tsx
   scripts/poll-live.ts` e vendo snapshots novas na `live_state`.
3. Depois da migração aplicada: `update live_seasons set active=false where
   id=132572;` → dentro de ≤5 min o poll deixa de processar matches ATP
   singles (verificável nos logs do runner ou na ausência de snapshots
   novas desse torneio). Reverter depois do teste.
4. `npx tsx scripts/add-season.ts 72469784 teste-mistas --doubles` upserta
   a row 136820 (já existente → no-op) e imprime nomes de jogadores reais.
5. Grep: nenhum uso remanescente de `ACTIVE_SEASONS` fora do fallback.
