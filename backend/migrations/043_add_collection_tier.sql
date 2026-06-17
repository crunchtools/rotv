-- Migration 043: Add collection_tier for tiered news collection scheduling
-- Tiers: 'daily', 'weekly', 'monthly'
-- Default is 'weekly' (safe middle ground)
-- The collection_tier column is the single source of truth for scheduling.
-- Admins can change any POI's tier at any time via the admin panel.
--
-- IMPORTANT: entrypoint.sh re-applies every migration on each container start,
-- so the one-time data backfill below MUST only run when the column is first
-- introduced. If it ran every boot it would revert admin tier changes on every
-- restart — which is exactly what kept forcing commercial POIs that have a
-- Facebook events_url (e.g. Green Valley Brewing Co.) back to 'daily'.

DO $$
DECLARE
  col_existed boolean;
BEGIN
  -- Capture whether the column already exists BEFORE we add it. On an existing
  -- database (every prod restart) this is true and the backfill is skipped, so
  -- tiers set by an admin are preserved. On a fresh database it is false and the
  -- backfill runs exactly once.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pois' AND column_name = 'collection_tier'
  ) INTO col_existed;

  -- DDL — idempotent, safe on every re-run.
  ALTER TABLE pois ADD COLUMN IF NOT EXISTS collection_tier TEXT DEFAULT 'weekly';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pois_collection_tier_check'
  ) THEN
    ALTER TABLE pois ADD CONSTRAINT pois_collection_tier_check
      CHECK (collection_tier IN ('daily', 'weekly', 'monthly'));
  END IF;

  -- One-time data backfill — only on first introduction of the column.
  IF NOT col_existed THEN
    -- Daily: POIs with a dedicated NEWS feed, plus Cleveland Metroparks.
    -- events_url is intentionally NOT a daily trigger: a Facebook events page is
    -- common for small/commercial POIs and causes daily over-collection. Such
    -- POIs default to 'weekly' and an admin can promote them if warranted.
    UPDATE pois SET collection_tier = 'daily'
    WHERE (news_url IS NOT NULL AND news_url != '')
       OR id = 5658;  -- Cleveland Metroparks (ToS prevents crawling, but Serper coverage is frequent)

    -- Monthly: known low-activity POIs (0-1 published items, no dedicated URLs)
    -- still at the default.
    UPDATE pois SET collection_tier = 'monthly'
    WHERE collection_tier = 'weekly'  -- only demote POIs still at default, not ones just set to daily
      AND id IN (
      5475, 5477, 5478, 5480, 5482, 5486, 5491, 5492, 5494, 5495,
      5496, 5497, 5498, 5500, 5501, 5502, 5504, 5506, 5513, 5514,
      5516, 5517, 5518, 5519, 5522, 5525, 5526, 5529, 5530, 5532,
      5534, 5535, 5536, 5538, 5540, 5542, 5546, 5547, 5551, 5554,
      5555, 5556, 5558, 5560, 5564, 5565, 5566, 5569, 5570, 5571,
      5572, 5573, 5574, 5576, 5578, 5579, 5581, 5582, 5584, 5586,
      5587, 5591, 5592, 5595, 5596, 5597, 5598, 5599, 5601, 5607,
      5609, 5610, 5611, 5616, 5618, 5623, 5624, 5625, 5627, 5628,
      5631, 5632, 5633, 5634, 5636, 5639, 5640, 5642, 5643, 5644,
      5645, 5646, 5647, 5650, 5651, 5652, 5655, 5657, 5661, 5664,
      5666, 5668, 5670, 5675, 5688, 5689, 5690, 5691, 5692, 5693,
      5694, 5695, 5696, 5697, 5698, 5699, 5700, 5703, 5704, 5705,
      5706, 5710, 5711, 5712, 5716, 5717, 5718, 5719, 5721, 5724,
      5725, 5726, 5727, 5730, 5731, 5732, 5736, 5738, 5741
    );
  END IF;
END $$;

-- Index for efficient tier-based queries (idempotent).
CREATE INDEX IF NOT EXISTS idx_pois_collection_tier ON pois (collection_tier);
