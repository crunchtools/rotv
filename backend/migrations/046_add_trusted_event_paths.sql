-- Add default trusted event paths for the events crawler.
-- These path patterns bypass the basePath filter, allowing the crawler
-- to follow detail links even when listing and detail pages use different paths.
INSERT INTO admin_settings (key, value) VALUES
  ('trusted_event_paths', '["/event","/events","/program","/programs","iteminfo.html","/store/p"]')
ON CONFLICT (key) DO NOTHING;
