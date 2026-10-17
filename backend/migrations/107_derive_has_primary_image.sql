-- Migration 107: has_primary_image is derived from poi_media, not stored (#770)
--   The stored flag drifted twice: 453 flagged / 53 real, then 755 / 143. Most of
--   it dates from 013, which turned every old Google Drive file id into TRUE, and
--   nothing that removed a photo ever cleared it. Release 1 filed the
--   image-server-only primaries in poi_media, so poi_media now holds every photo
--   the thumbnail route can serve.
--   The predicate matches /api/pois/:id/thumbnail: a published or auto-approved
--   primary or gallery image or video. Queries return it as has_primary_image,
--   so the API payload keeps its key.
-- Idempotent.

CREATE OR REPLACE FUNCTION poi_has_primary_image(poi integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM poi_media
     WHERE poi_id = poi
       AND role IN ('primary', 'gallery')
       AND media_type IN ('image', 'video')
       AND moderation_status IN ('published', 'auto_approved'))
$$;

ALTER TABLE pois DROP COLUMN IF EXISTS has_primary_image;
