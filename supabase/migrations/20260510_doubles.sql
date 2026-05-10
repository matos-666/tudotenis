-- Doubles infrastructure (Fase D1)
-- ──────────────────────────────────────────────────────────────────────────
-- Estratégia: per-player ELO de duplas (não per-team). Equipa = média dos
-- ratings dos seus 2 jogadores. Mais escalável que tracking de teams,
-- aproveita matches em que o jogador roda parceiros, e equipa nova não
-- "começa do zero" — herda do rating individual dos parceiros.

-- 1. Tabela de matches de duplas (catálogo construído via scraping diário) ──
create table if not exists doubles_matches (
  id bigserial primary key,
  -- Identificação (dedupe)
  source text not null default 'tennisstats',
  external_key text unique,        -- ex: 'rome-2026-05-10-sinner-dimitrov-vs-jodar-vasallo'
  -- Metadata
  tournament_id bigint references tournaments(id),
  tournament_name text,
  date date,
  scheduled_at timestamptz,
  surface text,
  round text,
  -- Equipas (4 fkeys + 4 nomes para forense)
  t1_p1_id bigint references players(id),
  t1_p2_id bigint references players(id),
  t2_p1_id bigint references players(id),
  t2_p2_id bigint references players(id),
  t1_p1_name text,
  t1_p2_name text,
  t2_p1_name text,
  t2_p2_name text,
  -- Resultado (NULL enquanto pendente; preenchido pelo settler)
  winner_team smallint check (winner_team in (1, 2)),
  score text,
  status text,                     -- 'Fin.', 'Ret.', 'W.O.', etc.
  -- Snapshot ELO no momento do match (forense / reconstrução)
  elo_t1_pre numeric,
  elo_t2_pre numeric,
  -- Timestamps
  created_at timestamptz default now() not null,
  settled_at timestamptz
);

create index if not exists doubles_matches_date_idx
  on doubles_matches (date desc);
create index if not exists doubles_matches_pending_idx
  on doubles_matches (created_at) where winner_team is null;
create index if not exists doubles_matches_t1p1_idx on doubles_matches (t1_p1_id);
create index if not exists doubles_matches_t1p2_idx on doubles_matches (t1_p2_id);
create index if not exists doubles_matches_t2p1_idx on doubles_matches (t2_p1_id);
create index if not exists doubles_matches_t2p2_idx on doubles_matches (t2_p2_id);

alter table doubles_matches enable row level security;

-- 2. Colunas de duplas no players (per-player ELO) ────────────────────────
alter table players add column if not exists elo_doubles_overall numeric;
alter table players add column if not exists elo_doubles_hard    numeric;
alter table players add column if not exists elo_doubles_clay    numeric;
alter table players add column if not exists elo_doubles_grass   numeric;
alter table players add column if not exists elo_doubles_indoor  numeric;
alter table players add column if not exists elo_doubles_30d_ago numeric;
alter table players add column if not exists doubles_matches     int default 0;
alter table players add column if not exists doubles_matches_24m int default 0;
