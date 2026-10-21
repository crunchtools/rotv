-- Live webcam link surfaced as a sidebar button (#791). Link-out only, no embed.
ALTER TABLE pois ADD COLUMN IF NOT EXISTS webcam_url VARCHAR(500);

COMMENT ON COLUMN pois.webcam_url IS 'External live webcam URL surfaced as a sidebar button (#791)';

UPDATE pois
SET webcam_url = 'https://liveworldwebcams.com/cuyahoga-river-webcam/', updated_at = NOW()
WHERE name IN ('Cuyahoga River', 'The Foundry') AND webcam_url IS NULL;
