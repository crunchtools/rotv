-- News topic deny list (filterLists.js DENY_LISTS).
-- Crime/violence stories from trusted news domains (fox8, news5, beaconjournal)
-- auto-approve and attach to park POIs on loose city/county name matches, landing
-- in the weekly digest. This list hard-rejects news whose title/summary contains
-- one of these terms (whole-word match). NEWS ONLY — events are never filtered by
-- it, so "murder mystery" / "vintage base ball" events are safe.
-- Admin-editable under Data Collection → News & Events Filters.
INSERT INTO admin_settings (key, value)
  VALUES ('news_topic_blocklist', '["manhunt","homicide","murder","attempted murder","shooter","gunman","gunmen","gunfire","shots fired","stabbing","standoff","carjacking","kidnapping","abduction","fugitive","police pursuit","police chase","high-speed chase","armed robbery","sexual assault"]')
  ON CONFLICT (key) DO NOTHING;
