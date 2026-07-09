-- Seasons monitorizadas pelo poll live. Move a config hardcoded de
-- ACTIVE_SEASONS (src/lib/live-poll.ts) para a DB, para que o live não
-- morra quando um torneio acaba (ex.: fim de Wimbledon) nem exija deploy
-- para adicionar torneios novos.

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
