-- Adiciona o que falta para um backtest completo das picks live.
--
-- 1. live_state ganha campos de outcome (vencedor + ts de fim) que
--    serão preenchidos pelo cron settle quando o match terminar.
-- 2. Tabela live_picks: histórico imutável das decisões do modelo.
--    Mesmo enquanto não temos odds, podemos popular com "pseudo-pick"
--    (model_prob + state) para depois fazer overlay com odds quando
--    Sprint 3a (ingest 1xBet) estiver pronto.
-- 3. Tabela live_odds_history: snapshots de odds por match/timestamp
--    quando começarmos a ingerir 1xBet.

-- ── live_state outcome ─────────────────────────────────────────
alter table live_state
  add column if not exists final_winner text check (final_winner in ('A', 'B')),
  add column if not exists final_score text,
  add column if not exists settled_at timestamptz;

create index if not exists live_state_finished_unsettled
  on live_state(sr_match_id)
  where match_finished = true and settled_at is null;

-- ── live_picks ─────────────────────────────────────────────────
-- Cada pick é uma decisão do modelo num timestamp + estado específico.
-- Imutável: nunca se actualiza após criação (excepto o settle).
create table if not exists live_picks (
  id                bigserial primary key,
  sr_match_id       bigint not null,
  state_snapshot_id bigint references live_state(id),

  -- Estado no momento da emissão
  set_a             smallint not null,
  set_b             smallint not null,
  game_a            smallint not null,
  game_b            smallint not null,
  point_a           smallint default 0,
  point_b           smallint default 0,
  server            text check (server in ('A', 'B')),
  tiebreak          boolean not null default false,
  score_description text,  -- ex: "1-0 set, 4-3 game, 30-15"

  -- Players
  player_a_id       bigint references players(id),
  player_b_id       bigint references players(id),
  name_a            text,
  name_b            text,
  tournament_slug   text,

  -- Decisão do modelo
  selection         text check (selection in ('A', 'B', 'over_total', 'under_total', 'set_a', 'set_b')),
  market            text not null default 'match_winner',
  model_prob        numeric(6,4) not null,
  point_importance  numeric(6,4),
  grade             text check (grade in ('A', 'B', 'C')),

  -- Odds (preenchido em Sprint 3a)
  live_odd          numeric(6,2),
  live_odd_source   text,
  edge_pct          numeric(6,2),
  stake             numeric(8,2) default 1,

  -- Outcome (preenchido pelo settle quando match acabar)
  result            text check (result in ('win', 'loss', 'void')),
  pl                numeric(10,2),
  settled_at        timestamptz,

  -- Metadados
  posted_at         timestamptz default now() not null,
  created_at        timestamptz default now() not null
);

create index if not exists live_picks_match     on live_picks(sr_match_id);
create index if not exists live_picks_posted    on live_picks(posted_at desc);
create index if not exists live_picks_result    on live_picks(result, posted_at desc);
create index if not exists live_picks_open      on live_picks(sr_match_id) where result is null;
create unique index if not exists live_picks_dedup
  on live_picks(sr_match_id, selection, set_a, set_b, game_a, game_b);

alter table live_picks enable row level security;
create policy "public read live_picks" on live_picks for select using (true);

-- ── live_odds_history ──────────────────────────────────────────
-- Snapshots de odds da casa (1xBet, etc.) sincronizados com
-- live_state pelo timestamp. Permite reconstituir o "ambiente
-- de mercado" em qualquer instante para backtest a posteriori.
create table if not exists live_odds_history (
  id              bigserial primary key,
  sr_match_id     bigint not null,
  source          text not null,                  -- '1xbet', 'pinnacle', etc.
  odd_a           numeric(6,2),
  odd_b           numeric(6,2),
  odd_over_games  numeric(6,2),
  odd_under_games numeric(6,2),
  line_games      numeric(4,1),
  raw_payload     jsonb,
  captured_at     timestamptz default now() not null
);

create index if not exists live_odds_match_time on live_odds_history(sr_match_id, captured_at desc);
create index if not exists live_odds_source     on live_odds_history(source);

alter table live_odds_history enable row level security;
create policy "public read live_odds_history" on live_odds_history for select using (true);
