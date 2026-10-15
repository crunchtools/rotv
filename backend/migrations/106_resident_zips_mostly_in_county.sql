-- Migration 106: A ZIP mostly in Summit County ticks resident Yes (#778 follow-up)
--   Migration 104 left Tallmadge (44278, about 95% in Summit) and Copley (44321,
--   about 96%) for the hiker to tick. Scott's call: a ZIP with 90% or more of its
--   area in the county ticks Yes; a hiker on the far side of the line can correct
--   it. Brecksville (44141, 8% in Summit) and the ZIPs split across the line stay
--   unticked.
--   Changed only while the lists are still 104's, so an admin's edit stands.
-- Idempotent.

UPDATE poi_lists
SET form_layout = jsonb_set(jsonb_set(form_layout,
      '{resident,zips}', '["44056", "44067", "44087", "44203", "44210", "44221", "44222", "44223", "44224", "44232", "44236", "44237", "44250", "44262", "44264", "44278", "44286"]'::jsonb),
      '{resident,unsureZips}', '["44141", "44202", "44216", "44230", "44240", "44260", "44281", "44614", "44685", "44720"]'::jsonb),
    updated_at = CURRENT_TIMESTAMP
WHERE series = 'fall-hiking-spree' AND edition = 2026
  AND form_layout->'resident'->'unsureZips' = '["44141", "44202", "44216", "44230", "44240", "44260", "44278", "44281", "44321", "44614", "44685", "44720"]'::jsonb;
