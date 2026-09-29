/**
 * Startup closes jobs a restart left queued/running past the resume window (#586).
 * Each case runs inside a transaction that is rolled back, so the seeded rows are
 * never visible to the other integration tests running against the same database.
 */
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { failAbandonedJobs as failAbandonedNewsJobs } from '../services/newsService.js';
import { failAbandonedJobs as failAbandonedTrailJobs } from '../services/trailStatusService.js';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD || 'rotv'
});

afterAll(() => pool.end());

const SEEDS = [
  { key: 'staleRunning', status: 'running', age: '2 hours', closed: true },
  { key: 'staleQueued', status: 'queued', age: '3 days', closed: true },
  { key: 'freshRunning', status: 'running', age: '10 minutes', closed: false },
  { key: 'staleCompleted', status: 'completed', age: '2 hours', closed: false }
];

describe.each([
  {
    label: 'news',
    failAbandonedJobs: failAbandonedNewsJobs,
    insertSql: "INSERT INTO news_job_status (job_type, status, created_at) VALUES ('abandoned_test', $1, NOW() - $2::interval) RETURNING id",
    selectSql: 'SELECT id, status, error_message, completed_at FROM news_job_status WHERE id = ANY($1)'
  },
  {
    label: 'trail status',
    failAbandonedJobs: failAbandonedTrailJobs,
    insertSql: "INSERT INTO trail_status_job_status (job_type, status, created_at) VALUES ('abandoned_test', $1, NOW() - $2::interval) RETURNING id",
    selectSql: 'SELECT id, status, error_message, completed_at FROM trail_status_job_status WHERE id = ANY($1)'
  }
])('failAbandonedJobs: $label', ({ failAbandonedJobs, insertSql, selectSql }) => {
  it('fails only queued/running jobs older than an hour, with a reason', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ids = {};
      for (const seed of SEEDS) {
        const inserted = await client.query(insertSql, [seed.status, seed.age]);
        ids[seed.key] = inserted.rows[0].id;
      }

      const failedIds = await failAbandonedJobs(client);

      const rows = await client.query(selectSql, [Object.values(ids)]);
      const byId = Object.fromEntries(rows.rows.map(row => [row.id, row]));

      for (const seed of SEEDS) {
        const row = byId[ids[seed.key]];
        if (seed.closed) {
          expect(failedIds).toContain(ids[seed.key]);
          expect(row.status).toBe('failed');
          expect(row.error_message).toMatch(/^Interrupted: server restarted/);
          expect(row.completed_at).not.toBeNull();
        } else {
          expect(failedIds).not.toContain(ids[seed.key]);
          expect(row.status).toBe(seed.status);
          expect(row.error_message).toBeNull();
        }
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
