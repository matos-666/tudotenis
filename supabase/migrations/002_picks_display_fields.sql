-- Migration 002: add display fields to picks
-- Apply via: Supabase Dashboard > SQL Editor > New query > Run

ALTER TABLE picks
  ADD COLUMN IF NOT EXISTS p1_name        text,
  ADD COLUMN IF NOT EXISTS p2_name        text,
  ADD COLUMN IF NOT EXISTS p1_flag        text,
  ADD COLUMN IF NOT EXISTS p2_flag        text,
  ADD COLUMN IF NOT EXISTS tournament_name text,
  ADD COLUMN IF NOT EXISTS surface        text,
  ADD COLUMN IF NOT EXISTS scheduled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS best_of        smallint default 3,
  ADD COLUMN IF NOT EXISTS betexplorer_id text;

-- Index for date range queries (page loads)
CREATE INDEX IF NOT EXISTS picks_posted_at_desc ON picks(posted_at DESC);

-- View for picks with all display data in one query
CREATE OR REPLACE VIEW picks_full AS
SELECT
  p.*,
  pl.name   AS player_name,
  pl.flag   AS player_flag,
  pl.elo_overall AS player_elo
FROM picks p
LEFT JOIN players pl ON p.player_id = pl.id;

-- Allow public read on the view
GRANT SELECT ON picks_full TO anon, authenticated;

SELECT 'Migration 002 applied' AS result;
