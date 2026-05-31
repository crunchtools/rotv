-- Migration 080: Backfill and correct trail activities so the activity filter
-- (e.g. selecting "Biking") only surfaces trails that actually allow that activity.
--
-- Three parts, all idempotent (guarded so re-runs are no-ops and so later admin
-- edits are not clobbered once a row no longer matches the known-bad state):
--   1. Untagged trails -> 'Hiking' (most are CVNP/Metro foot trails).
--   2. Drop 'Biking' from 11 footpaths that were mis-tagged as bikeable.
--   3. Bikeable multi-use trails on the allowlist (Towpath, Bike & Hike, Gateway,
--      etc.) keep their existing 'Hiking, Biking' tags — no change needed.

BEGIN;

-- 1. Untagged trails -> 'Hiking'
UPDATE pois
SET primary_activities = 'Hiking'
WHERE 'trail' = ANY(poi_roles)
  AND coalesce(deleted, false) = false
  AND coalesce(nullif(trim(primary_activities), ''), '') = '';

-- 2. Remove 'Biking' from hiking-only footpaths that were incorrectly tagged.
-- Element-wise: split on commas, drop the 'Biking' item, rejoin. Guarded by id list
-- + "still contains Biking" (Postgres word boundaries are \m \M, NOT \b), so it
-- fires once and re-runs as UPDATE 0. Gateway Trail (West Creek paved connector,
-- id 1018) and the paved/limestone multi-use trails are intentionally excluded.
UPDATE pois
SET primary_activities = (
      SELECT string_agg(trim(part), ', ')
      FROM unnest(string_to_array(primary_activities, ',')) AS part
      WHERE lower(trim(part)) <> 'biking'
    )
WHERE id IN (974, 1021, 1036, 1045, 1050, 1057, 1068, 1074, 1089, 1099, 1095)
  AND primary_activities ~* '\mBiking\M';

COMMIT;
