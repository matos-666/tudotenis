-- 20260518_elo_set_history.sql
-- Adiciona colunas set-level (Phase C) à tabela elo_history.
--
-- Contexto: as colunas legacy elo_* estão congeladas em Nov 2025; o site
-- agora usa elo_set_* como fonte de verdade. Para os charts de trajectória
-- terem dados frescos, precisamos de snapshots históricos do set-level.
--
-- Após aplicar, correr o train_set_elo.py com backfill de snapshots
-- mensais (24 meses) para popular estas colunas retroactivamente.

alter table elo_history
  add column if not exists elo_set_overall numeric(8,2),
  add column if not exists elo_set_hard    numeric(8,2),
  add column if not exists elo_set_clay    numeric(8,2),
  add column if not exists elo_set_grass   numeric(8,2);
