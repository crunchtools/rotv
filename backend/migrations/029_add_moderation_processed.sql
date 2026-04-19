-- Add moderation_processed flag to replace using confidence_score IS NULL as a "visited" marker
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS moderation_processed BOOLEAN DEFAULT FALSE;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderation_processed BOOLEAN DEFAULT FALSE;
ALTER TABLE photo_submissions ADD COLUMN IF NOT EXISTS moderation_processed BOOLEAN DEFAULT FALSE;

-- Backfill: any item that already has a confidence_score was already processed
UPDATE poi_news SET moderation_processed = TRUE WHERE confidence_score IS NOT NULL;
UPDATE poi_events SET moderation_processed = TRUE WHERE confidence_score IS NOT NULL;
UPDATE photo_submissions SET moderation_processed = TRUE WHERE confidence_score IS NOT NULL;

-- Also mark auto_approved items as processed (they skip the sweep)
UPDATE poi_news SET moderation_processed = TRUE WHERE moderation_status = 'auto_approved';
UPDATE poi_events SET moderation_processed = TRUE WHERE moderation_status = 'auto_approved';
UPDATE photo_submissions SET moderation_processed = TRUE WHERE moderation_status = 'auto_approved';
