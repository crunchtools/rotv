-- Migration 019: Moderation domain allowlists
-- Add admin_settings for trusted and competitor domain lists used by quality filters
-- Trusted domains: Federal sources (nps.gov, doi.gov, usgs.gov), Metro parks, Local news, Regional sources
-- Competitor domains: Scam/aggregator sites that receive severe quality penalty (×0.3)

INSERT INTO admin_settings (key, value) VALUES
  ('moderation_trusted_domains', '["nps.gov","doi.gov","usgs.gov","summitmetroparks.org","clevelandmetroparks.com","metroparks.org","cleveland.com","wkyc.com","fox8.com","beaconjournal.com","recordpub.com","ohiohistory.org","clevelandhistorical.org","wrhs.org"]'),
  ('moderation_competitor_domains', '["cuyahogavalley.com","cvnp.guide","cuyahogavalleyguide.com"]')
ON CONFLICT (key) DO NOTHING;
