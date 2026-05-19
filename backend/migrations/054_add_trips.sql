-- 054_add_trips.sql
-- Day-trip planning (issue #366). One trip = an ordered list of POI stops
-- a user has saved for handoff to Google Maps navigation. Admin-curated
-- "Featured Trips" live in the same table with is_featured = true.

CREATE TABLE IF NOT EXISTS trips (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  description  TEXT,
  slug         VARCHAR(220) UNIQUE NOT NULL,
  is_featured  BOOLEAN DEFAULT FALSE,
  is_public    BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_is_featured ON trips(is_featured) WHERE is_featured = TRUE;

-- trip_stops caches lat/lng so a trip remains usable if the referenced
-- POI is renamed, moved, or deleted (ON DELETE SET NULL). poi_id is a
-- soft link used to render the current POI name when present; label is
-- a manual override or fallback display name.
CREATE TABLE IF NOT EXISTS trip_stops (
  trip_id      INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  poi_id       INTEGER REFERENCES pois(id) ON DELETE SET NULL,
  label        VARCHAR(200),
  latitude     DECIMAL(10, 8) NOT NULL,
  longitude    DECIMAL(11, 8) NOT NULL,
  PRIMARY KEY (trip_id, position)
);

CREATE INDEX IF NOT EXISTS idx_trip_stops_poi_id ON trip_stops(poi_id);
