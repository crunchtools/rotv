-- 081_poi_event_series.sql
-- Recurring event series (spec 034-this-weekend-recurring-events, issue #436).
-- A series stores a recurrence RULE plus an explicit, admin-entered season range
-- (one row per recurring market/program). The rule is the source of truth; the
-- generator in eventSeriesService.js MATERIALIZES its occurrences as real poi_events
-- rows (linked by series_id) so recurring events appear everywhere regular events do
-- — newsletter, notifications, past/future, search, permalinks.
-- Re-runs on every container start, so all statements are idempotent.

CREATE TABLE IF NOT EXISTS poi_event_series (
  id               SERIAL PRIMARY KEY,
  -- poi_id is the ORGANIZER (who runs the event, e.g. the CVFM org).
  poi_id           INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  -- venue_poi_id is WHERE it physically happens (e.g. Howe Meadow), separate from the
  -- organizer. A venue's page surfaces the events whose venue_poi_id points at it.
  venue_poi_id     INTEGER REFERENCES pois(id) ON DELETE SET NULL,
  title            VARCHAR(500) NOT NULL,
  description      TEXT,
  event_type       VARCHAR(100),
  location_details TEXT,
  source_url       TEXT,
  image_url        TEXT,
  -- Recurrence rule (RFC 5545 subset). v1 honors WEEKLY (interval 1 = weekly,
  -- 2 = biweekly); MONTHLY reserved for later.
  freq             VARCHAR(10) NOT NULL DEFAULT 'WEEKLY',
  interval         INTEGER NOT NULL DEFAULT 1,
  byday            TEXT[] NOT NULL DEFAULT '{}',          -- e.g. {SU} or {SA}
  -- Explicit, admin-entered season bounds. Occurrences only within this range.
  -- Winter year-wrap is an ordinary range (e.g. 2025-11-01 .. 2026-04-25).
  -- Biweekly anchors on the first `byday` match on/after season_start.
  season_start     DATE NOT NULL,
  season_end       DATE NOT NULL,
  -- Exception dates (EXDATE): in-season dates the event is skipped (e.g. holiday closures).
  exdates          DATE[] NOT NULL DEFAULT '{}',
  -- Time of day (optional)
  time_start       TIME,
  time_end         TIME,
  -- Provenance / moderation (mirror poi_events conventions)
  content_source   VARCHAR(20) DEFAULT 'human',
  moderation_status VARCHAR(20) DEFAULT 'published',
  active           BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poi_event_series_poi_id ON poi_event_series (poi_id);
CREATE INDEX IF NOT EXISTS idx_poi_event_series_venue ON poi_event_series (venue_poi_id);
CREATE INDEX IF NOT EXISTS idx_poi_event_series_active ON poi_event_series (active);

-- One-off events get the same organizer/venue split: poi_id is who runs it, venue_poi_id
-- is where it happens. Lets a venue POI surface events held there by other organizers
-- (e.g. concerts at Howe Meadow run by the Conservancy). Nullable; existing events keep
-- their free-text location_details.
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS venue_poi_id INTEGER REFERENCES pois(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_poi_events_venue ON poi_events (venue_poi_id);

-- Materialized recurring occurrences: a poi_events row generated from a series carries
-- series_id (its parent rule) and recurrence_label (denormalized cadence for display,
-- e.g. "Weekly: Saturdays"). ON DELETE SET NULL so removing a series can orphan past
-- occurrences as standalone history rather than erasing them. The unique index keeps the
-- generator idempotent (one row per series per start); one-off events keep series_id NULL,
-- and NULLs are distinct in a unique index so they stay unconstrained.
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS series_id INTEGER REFERENCES poi_event_series(id) ON DELETE SET NULL;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS recurrence_label TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_poi_events_series_start
  ON poi_events (series_id, start_date);

-- Materialized occurrences use content_source 'recurring'; widen the existing CHECK to allow it.
ALTER TABLE poi_events DROP CONSTRAINT IF EXISTS chk_events_content_source;
ALTER TABLE poi_events ADD CONSTRAINT chk_events_content_source
  CHECK (content_source IN ('human', 'ai', 'newsletter', 'feed', 'api', 'community', 'recurring'));
