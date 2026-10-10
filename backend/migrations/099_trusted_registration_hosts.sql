-- Migration 099: follow event links to a registration site
-- An events page that sends each event to a registration site lost those events:
-- the crawl dropped every off-site link whose path was not in trusted_content_paths.
-- An entry in that list may now be a hostname. Seeds the one host with evidence
-- (Cleveland Metroparks Zoo's 5Ks register on runsignup.com); more are added from
-- Settings > Data Collection > Filters.
-- Idempotent: runs on every boot, appends only while the host is absent.

UPDATE admin_settings
SET value = (value::jsonb || '["runsignup.com"]'::jsonb)::text,
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'trusted_content_paths'
  AND NOT (value::jsonb ? 'runsignup.com');
