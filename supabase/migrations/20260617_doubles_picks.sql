-- 20260617_doubles_picks.sql
-- Tabela `doubles_picks` para picks de duplas. Mirror conceptual de `picks`
-- mas team-level (2 jogadores por lado em vez de 1).
--
-- Modelo: a cada doubles_match com odds + EV ≥ threshold, geramos uma row
-- em doubles_picks com `team_selected` = 1 ou 2 (qual equipa escolhemos).
--
-- Settle: o settle cron já marca `winner_team` em doubles_matches via
-- applyDoublesEloUpdate. Aqui acrescentamos: também marcar result/pl em
-- doubles_picks que referenciam esse match.

create table if not exists doubles_picks (
  id              bigserial primary key,
  -- Identificação / dedupe
  doubles_match_id bigint not null references doubles_matches(id) on delete cascade,
  external_key    text,                  -- copy de doubles_matches.external_key
  source          text not null default 'tennisstats',

  -- Equipa escolhida
  team_selected   smallint not null check (team_selected in (1, 2)),

  -- Snapshot dos jogadores no momento do pick (4 IDs + 4 nomes p/ display)
  t1_p1_id        bigint references players(id),
  t1_p2_id        bigint references players(id),
  t2_p1_id        bigint references players(id),
  t2_p2_id        bigint references players(id),
  t1_p1_name      text,
  t1_p2_name      text,
  t2_p1_name      text,
  t2_p2_name      text,
  t1_p1_flag      text,
  t1_p2_flag      text,
  t2_p1_flag      text,
  t2_p2_flag      text,

  -- Pick economics
  market          text not null default 'Vencedora dupla',
  odd             numeric(5,2) not null,
  edge_pct        numeric(5,2) not null,    -- nome mantido = EV% (compatível UI)
  grade           text not null,            -- 'A' | 'B' | 'C'
  stake           numeric(8,2) default 10,

  -- Contexto
  tournament_name text,
  surface         text,
  scheduled_at    timestamptz,

  -- Settle (preenchido pelo settle cron)
  result          text,                     -- 'win' | 'loss' | 'void'
  pl              numeric(10,2),
  settled_at      timestamptz,

  -- Timestamps
  posted_at       timestamptz default now() not null,
  created_at      timestamptz default now() not null
);

-- Indexes
create index if not exists doubles_picks_match     on doubles_picks(doubles_match_id);
create index if not exists doubles_picks_posted    on doubles_picks(posted_at desc);
create index if not exists doubles_picks_result    on doubles_picks(result, posted_at desc);

-- Dedup parcial: mesmo match, mesma equipa = 1 pick por dia (evita duplicados
-- entre cron Vercel + GitHub Action, igual ao tennisstats_slug dos singles)
create unique index if not exists doubles_picks_dedup_idx
  on doubles_picks ((timezone('UTC', posted_at)::date), doubles_match_id, team_selected);

-- RLS — leitura pública
alter table doubles_picks enable row level security;
create policy "public read doubles_picks" on doubles_picks for select using (true);

select 'doubles_picks created' as result;
