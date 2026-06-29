-- Live in-play state from Sportradar + our model output.
-- Append-only snapshots; one row per (sportradar_match_id, captured_at).

create table if not exists live_state (
  id                bigserial primary key,
  sr_match_id       bigint not null,
  sr_season_id      bigint,
  sr_tournament_id  bigint,
  tournament_slug   text,

  -- Score snapshot
  set_a             smallint not null default 0,
  set_b             smallint not null default 0,
  game_a            smallint not null default 0,
  game_b            smallint not null default 0,
  point_a           smallint not null default 0,
  point_b           smallint not null default 0,
  server            text check (server in ('A', 'B')),
  tiebreak          boolean not null default false,
  best_of           smallint not null default 3,
  match_finished    boolean not null default false,

  -- Players (resolved via sr_player_map; nullable until matched)
  player_a_id       bigint references players(id),
  player_b_id       bigint references players(id),
  sr_team_a_id      bigint,
  sr_team_b_id      bigint,
  name_a            text,
  name_b            text,

  -- Live stats (from match_detailsextended)
  aces_a            smallint, aces_b            smallint,
  df_a              smallint, df_b              smallint,
  first_serve_in_a  numeric(5,2), first_serve_in_b numeric(5,2),
  first_serve_won_a numeric(5,2), first_serve_won_b numeric(5,2),
  bp_won_a          smallint, bp_won_b          smallint,
  bp_total_a        smallint, bp_total_b        smallint,
  serve_pts_won_a   smallint, serve_pts_won_b   smallint,
  serve_pts_total_a smallint, serve_pts_total_b smallint,

  -- Model output (computed server-side from this snapshot)
  p_a_serve_prior   numeric(6,4),
  p_b_serve_prior   numeric(6,4),
  p_a_serve_live    numeric(6,4),
  p_b_serve_live    numeric(6,4),
  match_win_prob_a  numeric(6,4),
  set_win_prob_a    numeric(6,4),
  point_importance  numeric(6,4),

  -- Live odds snapshot if available (1xBet etc.)
  live_odd_a        numeric(6,2),
  live_odd_b        numeric(6,2),
  live_odd_source   text,

  -- Coverage flags
  running           boolean not null default false,
  raw_payload       jsonb,

  captured_at       timestamptz default now() not null
);

create index if not exists live_state_match_time on live_state(sr_match_id, captured_at desc);
create index if not exists live_state_running     on live_state(running, captured_at desc) where running = true;
create index if not exists live_state_tournament  on live_state(tournament_slug, captured_at desc);

-- Compact "latest snapshot per match" view
create or replace view live_state_latest as
  select distinct on (sr_match_id) *
  from live_state
  order by sr_match_id, captured_at desc;

alter table live_state enable row level security;
create policy "public read live_state" on live_state for select using (true);
create policy "public read live_state_latest" on live_state for select using (true);

-- Mapping: Sportradar team-id → our players.id
-- Populado on-demand pelo cron quando encontra um sr_team_id desconhecido.
create table if not exists sr_player_map (
  sr_team_id        bigint primary key,
  player_id         bigint references players(id),
  sr_name           text,
  matched_name      text,
  match_confidence  numeric(3,2),
  match_method      text,
  created_at        timestamptz default now() not null,
  updated_at        timestamptz default now() not null
);

create index if not exists sr_player_map_player on sr_player_map(player_id);

alter table sr_player_map enable row level security;
create policy "public read sr_player_map" on sr_player_map for select using (true);
