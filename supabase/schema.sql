-- TUDOTENIS - Schema Supabase
-- Aplicar via: Supabase Dashboard > SQL Editor > New query > Run

create extension if not exists "uuid-ossp";

-- PLAYERS
create table if not exists players (
  id              bigserial primary key,
  slug            text not null unique,
  name            text not null,
  country         text,
  flag            text,
  birth_date      date,
  height_cm       integer,
  hand            text,
  tour            text not null,
  atp_rank        integer,
  photo_url       text,
  elo_overall     integer default 1500,
  elo_hard        integer default 1500,
  elo_clay        integer default 1500,
  elo_grass       integer default 1500,
  elo_indoor      integer default 1500,
  elo_30d_ago     integer,
  form_l5         text,
  titles          integer default 0,
  slams           integer default 0,
  career_high_atp integer,
  active          boolean default true,
  updated_at      timestamptz default now(),
  created_at      timestamptz default now()
);

create index if not exists players_slug_idx     on players(slug);
create index if not exists players_tour_rank    on players(tour, atp_rank);
create index if not exists players_elo_overall  on players(elo_overall desc);

-- TOURNAMENTS
create table if not exists tournaments (
  id              bigserial primary key,
  slug            text not null unique,
  name            text not null,
  full_name       text,
  year            integer not null,
  tour            text not null,
  category        text,
  surface         text,
  surface_label   text,
  location        text,
  country         text,
  flag            text,
  start_date      date,
  end_date        date,
  prize_money     text,
  draw_size       text,
  status          text default 'scheduled',
  atp_winner_id   bigint references players(id),
  atp_finalist_id bigint references players(id),
  atp_score       text,
  wta_winner_id   bigint references players(id),
  wta_finalist_id bigint references players(id),
  wta_score       text,
  story           text,
  wiki_slug       text,
  updated_at      timestamptz default now(),
  created_at      timestamptz default now()
);

create index if not exists tournaments_slug_idx on tournaments(slug);
create index if not exists tournaments_year     on tournaments(year, start_date);
create index if not exists tournaments_status   on tournaments(status);

-- MATCHES
create table if not exists matches (
  id            bigserial primary key,
  tournament_id bigint references tournaments(id) on delete set null,
  date          date not null,
  surface       text,
  round         text,
  player1_id    bigint references players(id),
  player2_id    bigint references players(id),
  winner_id     bigint references players(id),
  score         text,
  best_of       smallint default 3,
  elo1_before   integer,
  elo2_before   integer,
  elo1_after    integer,
  elo2_after    integer,
  duration_min  integer,
  status        text default 'scheduled',
  live_score    text,
  created_at    timestamptz default now()
);

create index if not exists matches_date         on matches(date desc);
create index if not exists matches_p1_p2        on matches(player1_id, player2_id);
create index if not exists matches_p2_p1        on matches(player2_id, player1_id);
create index if not exists matches_tournament   on matches(tournament_id);
create index if not exists matches_status_date  on matches(status, date desc);

-- ELO HISTORY
create table if not exists elo_history (
  id            bigserial primary key,
  player_id     bigint not null references players(id) on delete cascade,
  date          date not null,
  elo_overall   integer,
  elo_hard      integer,
  elo_clay      integer,
  elo_grass     integer,
  elo_indoor    integer,
  unique (player_id, date)
);

create index if not exists elo_history_player_date on elo_history(player_id, date desc);

-- PICKS
create table if not exists picks (
  id            bigserial primary key,
  match_id      bigint references matches(id),
  player_id     bigint references players(id),
  market        text not null,
  selection     text not null,
  odd           numeric(5,2),
  edge_pct      numeric(5,2),
  grade         text,
  stake         numeric(8,2) default 10,
  result        text,
  pl            numeric(10,2),
  settled_at    timestamptz,
  source        text,
  posted_at     timestamptz default now(),
  created_at    timestamptz default now()
);

create index if not exists picks_match         on picks(match_id);
create index if not exists picks_result_posted on picks(result, posted_at desc);
create index if not exists picks_grade_posted  on picks(grade, posted_at desc);

-- ROW LEVEL SECURITY
alter table players      enable row level security;
alter table tournaments  enable row level security;
alter table matches      enable row level security;
alter table elo_history  enable row level security;
alter table picks        enable row level security;

create policy "public read players"     on players      for select using (true);
create policy "public read tournaments" on tournaments  for select using (true);
create policy "public read matches"     on matches      for select using (true);
create policy "public read elo_history" on elo_history  for select using (true);
create policy "public read picks"       on picks        for select using (true);

-- VIEWS
create or replace view top_movers_7d as
select p.*, (p.elo_overall - coalesce(eh.elo_overall, p.elo_overall)) as delta_7d
from players p
left join lateral (
  select elo_overall from elo_history
  where player_id = p.id and date <= current_date - 7
  order by date desc limit 1
) eh on true
where p.active = true and p.elo_overall is not null
order by abs(p.elo_overall - coalesce(eh.elo_overall, p.elo_overall)) desc;

select 'Schema applied successfully' as result;
