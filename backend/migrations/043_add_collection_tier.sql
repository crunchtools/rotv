-- Migration 043: Add collection_tier for tiered news collection scheduling
-- Tiers: 'daily', 'weekly', 'monthly'
-- Default is 'weekly' (safe middle ground)
-- The collection_tier column is the single source of truth for scheduling.
-- Admins can change any POI's tier at any time via the admin panel.

ALTER TABLE pois ADD COLUMN IF NOT EXISTS collection_tier TEXT DEFAULT 'weekly';

-- Add CHECK constraint for valid values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pois_collection_tier_check'
  ) THEN
    ALTER TABLE pois ADD CONSTRAINT pois_collection_tier_check
      CHECK (collection_tier IN ('daily', 'weekly', 'monthly'));
  END IF;
END $$;

-- Index for efficient tier-based queries
CREATE INDEX IF NOT EXISTS idx_pois_collection_tier ON pois (collection_tier);

-- Set daily tier for POIs with dedicated news/events URLs + Cleveland Metroparks
UPDATE pois SET collection_tier = 'daily'
WHERE (news_url IS NOT NULL AND news_url != '')
   OR (events_url IS NOT NULL AND events_url != '')
   OR id = 5658;  -- Cleveland Metroparks (ToS prevents crawling, but Serper coverage is frequent)

-- Set monthly tier for low-activity POIs (0-1 published items, no dedicated URLs)
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
