-- 074_add_user_visits.sql
-- Visited list (spec 031-visited-list, issue #429). Logged-in users mark POIs
-- as visited here, building a personal exploration log ("23 of 371 explored").
-- Anonymous visitors accumulate visited POIs in localStorage and sync into this
-- table on first sign-in via /api/user/settings/sync. Re-runs on every container
-- start, so all statements are idempotent. No backfill — this is a new feature.

CREATE TABLE IF NOT EXISTS user_visits (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poi_id     INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, poi_id)
);

CREATE INDEX IF NOT EXISTS idx_user_visits_poi ON user_visits (poi_id);
