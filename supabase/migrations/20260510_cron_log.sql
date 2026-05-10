-- Cron job execution log.
-- Cada execução (manual ou programada) regista uma linha:
--   started_at: começo
--   finished_at: NULL enquanto a correr
--   ok: TRUE/FALSE no fim
--   message: erro / sumário
--   details: payload extra (jsonb)
--
-- Admin pode consultar via /admin/cron e re-disparar manualmente.

create table if not exists cron_log (
  id bigserial primary key,
  job text not null,                 -- 'picks' | 'settle' | 'manual_picks' | 'manual_settle'
  started_at timestamptz default now() not null,
  finished_at timestamptz,
  ok boolean,
  message text,
  details jsonb
);

create index if not exists cron_log_job_started_idx
  on cron_log (job, started_at desc);

create index if not exists cron_log_started_idx
  on cron_log (started_at desc);

-- RLS: só service_role escreve/lê.
alter table cron_log enable row level security;
