-- 20260518_outright_odds.sql
-- Outright odds (tournament winner) raspadas do Oddschecker.
--
-- Modelo:
--   tournaments.oddschecker_url → URL da página /winner do torneio
--   outright_odds                → 1 linha por (tournament, raw_name)
--                                  guarda best decimal odds + bookmakers + match
--
-- O cron /api/cron/outrights popula a tabela diariamente.

alter table tournaments
  add column if not exists oddschecker_url text;

create table if not exists outright_odds (
  id              bigserial primary key,
  tournament_id   bigint not null references tournaments(id) on delete cascade,
  player_id       bigint references players(id) on delete cascade,
  raw_name        text not null,
  best_decimal    numeric(8,2) not null,
  best_bookies    text,
  implied_prob    numeric(6,4) not null,
  fetched_at      timestamptz not null default now(),
  unique (tournament_id, raw_name)
);

create index if not exists outright_odds_tournament on outright_odds(tournament_id);
create index if not exists outright_odds_player     on outright_odds(player_id);

-- Comentário: o player_id pode ser NULL quando o raw_name do Oddschecker
-- não bate com nenhum jogador da nossa DB (typo, transliteração). Esses
-- ficam guardados na mesma para inspecção no admin.
