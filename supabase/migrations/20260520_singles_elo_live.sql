-- 20260520_singles_elo_live.sql
-- Adiciona tracking para aplicação incremental de ELO singles via
-- /api/cron/settle. Espelha o que doubles já faz mas mais explícito.
--
-- Idempotência: cada pick que termina com resultado conhecido (e que
-- temos os 2 player_id na DB) aplica delta-ELO. Marcamos elo_applied=true
-- para não duplicar updates em caso de re-run do cron, OU se vários
-- picks existirem para o mesmo match (mesmo tennisstats_slug).

alter table picks
  add column if not exists elo_applied boolean not null default false;

-- Útil para o settle cron filtrar
create index if not exists picks_elo_applied_idx
  on picks (elo_applied)
  where elo_applied = false;
