-- Set-level ELO (Phase C)
-- ──────────────────────────────────────────────────────────────────────────
-- Treina ELO em outcomes de set individuais em vez de match. Composição
-- via fórmula BO3/BO5 dá match probability correcta para cada formato.
--
-- Columns são paralelas ao elo_* existente (match-level) para permitir
-- shadow run + validação antes de migrar a UI.

alter table players add column if not exists elo_set_overall numeric;
alter table players add column if not exists elo_set_hard    numeric;
alter table players add column if not exists elo_set_clay    numeric;
alter table players add column if not exists elo_set_grass   numeric;
alter table players add column if not exists set_count       int default 0;

create index if not exists players_elo_set_overall_idx
  on players (elo_set_overall desc nulls last)
  where active = true;
