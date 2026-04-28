-- Rename moderation_competitor_domains → blocklist_urls.
-- Entries are URL prefixes (domains or domain+path) matched as lowercase startsWith.
-- Drives both moderation quality filtering AND phase 2 collection URL filtering.
UPDATE admin_settings
  SET key = 'blocklist_urls'
  WHERE key = 'moderation_competitor_domains';

-- Ensure the key exists with defaults if it wasn't set yet
INSERT INTO admin_settings (key, value)
  VALUES ('blocklist_urls', '["cuyahogavalley.com","cvnp.guide","cuyahogavalleyguide.com"]')
  ON CONFLICT (key) DO NOTHING;
