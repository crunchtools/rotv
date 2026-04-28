-- Migration 036: Change TIMESTAMP WITHOUT TIME ZONE → TIMESTAMPTZ
-- The server timezone is UTC, so existing values are already UTC.
-- AT TIME ZONE 'UTC' interprets the bare timestamps as UTC during the cast.
-- publication_date (DATE) is intentionally left as DATE — it is a
-- timezone-agnostic calendar date and needs no conversion.
--
-- Must drop and recreate moderation_queue view since it depends on collection_date.

DROP VIEW IF EXISTS moderation_queue CASCADE;
DROP VIEW IF EXISTS newsletter_digest CASCADE;

ALTER TABLE poi_events
  ALTER COLUMN start_date      TYPE TIMESTAMPTZ USING start_date      AT TIME ZONE 'UTC',
  ALTER COLUMN end_date        TYPE TIMESTAMPTZ USING end_date        AT TIME ZONE 'UTC',
  ALTER COLUMN collection_date TYPE TIMESTAMPTZ USING collection_date AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at      TYPE TIMESTAMPTZ USING updated_at      AT TIME ZONE 'UTC',
  ALTER COLUMN moderated_at    TYPE TIMESTAMPTZ USING moderated_at    AT TIME ZONE 'UTC';

ALTER TABLE poi_news
  ALTER COLUMN collection_date  TYPE TIMESTAMPTZ USING collection_date  AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at       TYPE TIMESTAMPTZ USING updated_at       AT TIME ZONE 'UTC',
  ALTER COLUMN moderated_at     TYPE TIMESTAMPTZ USING moderated_at     AT TIME ZONE 'UTC',
  ALTER COLUMN publication_date TYPE TIMESTAMPTZ
    USING (publication_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC';

ALTER TABLE poi_events
  ALTER COLUMN publication_date TYPE TIMESTAMPTZ
    USING (publication_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC';

-- Recreate moderation_queue view (identical logic, column types now TIMESTAMPTZ)
CREATE OR REPLACE VIEW moderation_queue AS
  SELECT poi_news.id,
    'news'::text AS content_type,
    poi_news.poi_id,
    poi_news.title,
    poi_news.summary AS description,
    poi_news.moderation_status,
    poi_news.confidence_score,
    poi_news.ai_reasoning,
    poi_news.submitted_by,
    poi_news.moderated_by,
    poi_news.moderated_at,
    poi_news.collection_date AS created_at,
    poi_news.content_source,
    poi_news.publication_date,
    poi_news.date_consensus_score
  FROM poi_news
  WHERE poi_news.moderation_status::text = 'pending'::text
UNION ALL
  SELECT poi_events.id,
    'event'::text AS content_type,
    poi_events.poi_id,
    poi_events.title,
    poi_events.description,
    poi_events.moderation_status,
    poi_events.confidence_score,
    poi_events.ai_reasoning,
    poi_events.submitted_by,
    poi_events.moderated_by,
    poi_events.moderated_at,
    poi_events.collection_date AS created_at,
    poi_events.content_source,
    poi_events.publication_date,
    poi_events.date_consensus_score
  FROM poi_events
  WHERE poi_events.moderation_status::text = 'pending'::text
UNION ALL
  SELECT photo_submissions.id,
    'photo'::text AS content_type,
    photo_submissions.poi_id,
    photo_submissions.original_filename AS title,
    photo_submissions.caption AS description,
    photo_submissions.moderation_status,
    photo_submissions.confidence_score,
    photo_submissions.ai_reasoning,
    photo_submissions.submitted_by,
    photo_submissions.moderated_by,
    photo_submissions.moderated_at,
    photo_submissions.created_at,
    NULL::character varying AS content_source,
    NULL::date AS publication_date,
    0 AS date_consensus_score
  FROM photo_submissions
  WHERE photo_submissions.moderation_status::text = 'pending'::text
  ORDER BY 12 DESC;

-- Recreate newsletter_digest view
CREATE OR REPLACE VIEW newsletter_digest AS
  SELECT poi_news.id,
    'news'::text AS content_type,
    poi_news.poi_id,
    poi_news.title,
    poi_news.summary AS description,
    poi_news.collection_date AS created_at,
    poi_news.moderated_at,
    poi_news.content_source
  FROM poi_news
  WHERE (poi_news.moderation_status::text = ANY (ARRAY['published'::character varying, 'auto_approved'::character varying]::text[]))
    AND poi_news.weekly_newsletter = true
    AND poi_news.collection_date >= (now() - '7 days'::interval)
UNION ALL
  SELECT poi_events.id,
    'event'::text AS content_type,
    poi_events.poi_id,
    poi_events.title,
    poi_events.description,
    poi_events.collection_date AS created_at,
    poi_events.moderated_at,
    poi_events.content_source
  FROM poi_events
  WHERE (poi_events.moderation_status::text = ANY (ARRAY['published'::character varying, 'auto_approved'::character varying]::text[]))
    AND poi_events.weekly_newsletter = true
    AND poi_events.collection_date >= (now() - '7 days'::interval)
UNION ALL
  SELECT photo_submissions.id,
    'photo'::text AS content_type,
    photo_submissions.poi_id,
    photo_submissions.original_filename AS title,
    photo_submissions.caption AS description,
    photo_submissions.created_at,
    photo_submissions.moderated_at,
    NULL::character varying AS content_source
  FROM photo_submissions
  WHERE (photo_submissions.moderation_status::text = ANY (ARRAY['approved'::character varying, 'auto_approved'::character varying]::text[]))
    AND photo_submissions.weekly_newsletter = true
    AND photo_submissions.created_at >= (now() - '7 days'::interval)
  ORDER BY 6 DESC;
