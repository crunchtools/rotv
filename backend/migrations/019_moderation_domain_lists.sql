-- Migration 019: Moderation domain allowlists
-- Add admin_settings for trusted domains and blocklist used by quality filters and phase 2 collection
-- Trusted domains: Federal sources (nps.gov, doi.gov, usgs.gov), Metro parks, Local news, Regional sources
-- Blocklist domains: Competitor/scam/useless sites blocked from moderation and phase 2 URL processing

INSERT INTO admin_settings (key, value) VALUES
  ('moderation_trusted_domains', '["nps.gov","doi.gov","usgs.gov","summitmetroparks.org","clevelandmetroparks.com","metroparks.org","cleveland.com","wkyc.com","fox8.com","beaconjournal.com","recordpub.com","ohiohistory.org","clevelandhistorical.org","wrhs.org"]'),
  ('blocklist_urls', '["cuyahogavalley.com","cvnp.guide","cuyahogavalleyguide.com"]')
ON CONFLICT (key) DO NOTHING;
