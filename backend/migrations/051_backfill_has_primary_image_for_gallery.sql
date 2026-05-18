-- Backfill pois.has_primary_image for POIs whose only published media is gallery-role.
-- The /api/pois/:id/thumbnail endpoint now falls back to oldest published gallery photo
-- when no primary exists, so any POI with a published image/video should report
-- has_primary_image=true to surface the tooltip.
--
-- Idempotent: only updates POIs currently flagged false.

UPDATE pois
SET has_primary_image = true,
    updated_at = CURRENT_TIMESTAMP
WHERE has_primary_image = false
  AND id IN (
    SELECT DISTINCT poi_id
    FROM poi_media
    WHERE media_type IN ('image', 'video')
      AND moderation_status IN ('published', 'auto_approved')
  );
