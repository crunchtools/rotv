-- Sequence for generating unique run IDs for single-POI news/events collections.
-- Used as job_id in job_logs to distinguish separate collection attempts for the same POI.
CREATE SEQUENCE IF NOT EXISTS single_poi_run_id_seq START WITH 100000;
