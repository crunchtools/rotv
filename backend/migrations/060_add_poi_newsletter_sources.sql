-- 060_add_poi_newsletter_sources.sql
-- Maps an inbound newsletter sender to the POI it belongs to (spec 020).
-- A newsletter comes from one organization (e.g. Akron Zoo), so the whole
-- email is scoped to one POI and crawled through the standard collection
-- pipeline. from_pattern is matched (case-insensitive substring) against
-- newsletter_emails.from_address. Unmapped senders are quarantined until an
-- admin assigns a POI, which inserts a row here. Re-runs every container
-- start, so all statements are idempotent.

CREATE TABLE IF NOT EXISTS poi_newsletter_sources (
  poi_id       INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  from_pattern TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poi_id, from_pattern)
);

CREATE INDEX IF NOT EXISTS idx_poi_newsletter_sources_pattern
  ON poi_newsletter_sources (LOWER(from_pattern));
