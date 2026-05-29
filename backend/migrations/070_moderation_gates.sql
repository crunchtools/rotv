-- Migration 070: Three-gate auto-moderation
-- Spec 030-moderation-gates
--
-- Stores the per-item verdicts of the three independent moderation gates
-- (date / relevance / POI) so the admin queue can show exactly which gate
-- needs a human. Additive and idempotent — re-runs on every container start.

ALTER TABLE poi_news   ADD COLUMN IF NOT EXISTS moderation_gates JSONB;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderation_gates JSONB;

-- Date gate: dates below this year are implausible (e.g. hallucinated 1800s
-- values) and fail the gate to review instead of passing.
-- Sweep batch: items scored per content type per scheduled sweep cycle
-- (raised from the old hardcoded 20 so a monthly dump clears in a few cycles).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_settings') THEN
    INSERT INTO admin_settings (key, value, updated_at)
    VALUES
      ('moderation_date_floor_year', '2010', CURRENT_TIMESTAMP),
      ('moderation_sweep_batch_size', '50', CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO NOTHING;
  END IF;
END$$;
