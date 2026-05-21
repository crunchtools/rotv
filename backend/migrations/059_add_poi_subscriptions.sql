-- 059_add_poi_subscriptions.sql
-- POI subscriptions / favorites (spec 019-poi-subscriptions, issue #213).
-- Logged-in users favorite POIs here; this table also backs the personalized
-- weekly email digest. The in-app notification bell computes unread state
-- client-side (favorites + a last-seen timestamp vs recent content), so there
-- is no server-side notifications table. Re-runs on every container start, so
-- all statements are idempotent.

CREATE TABLE IF NOT EXISTS user_poi_favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poi_id     INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, poi_id)
);

CREATE INDEX IF NOT EXISTS idx_user_poi_favorites_poi ON user_poi_favorites (poi_id);

-- Backfill favorites from the legacy users.favorite_destinations array.
INSERT INTO user_poi_favorites (user_id, poi_id)
SELECT u.id, p
FROM users u, UNNEST(u.favorite_destinations) AS p
WHERE p IS NOT NULL
ON CONFLICT DO NOTHING;
