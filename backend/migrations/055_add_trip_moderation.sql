-- 055_add_trip_moderation.sql
-- Public user trips (is_public = TRUE) go through a moderation queue before
-- becoming visible in the "Find Trips" picker, mirroring how News, Events,
-- and Photos are reviewed. Featured trips (is_featured = TRUE, admin-set)
-- bypass approval because the admin curating them is the moderator.

ALTER TABLE trips ADD COLUMN IF NOT EXISTS is_approved  BOOLEAN DEFAULT FALSE;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS moderated_by INTEGER REFERENCES users(id);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_trips_pending
  ON trips(is_public, is_approved)
  WHERE is_public = TRUE AND is_approved = FALSE;
