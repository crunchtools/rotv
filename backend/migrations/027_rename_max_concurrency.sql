-- Migration 027: Rename news_max_concurrency to max_concurrency
-- The concurrency setting applies to all collection runs (news, events, both),
-- not just news. Rename the key to reflect this.

UPDATE admin_settings
SET key = 'max_concurrency'
WHERE key = 'news_max_concurrency';
