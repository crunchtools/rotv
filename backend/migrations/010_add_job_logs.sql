-- Migration 010: Add job_logs table for structured job logging
-- Provides per-POI, per-job log entries visible in the admin Jobs dashboard.

CREATE TABLE IF NOT EXISTS job_logs (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL,
    job_type VARCHAR(50) NOT NULL,
    poi_id INTEGER,
    poi_name VARCHAR(255),
    level VARCHAR(10) NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_type, job_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_created ON job_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_logs_level ON job_logs(level) WHERE level IN ('warn', 'error');
