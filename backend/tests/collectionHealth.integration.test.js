/**
 * Collection health (#888) against a real database. The unit tests mock the
 * pool, so they prove the verdict logic and nothing about the SQL underneath
 * it: a wrong column or a wrong `job_type` filter would leave the Nagios check
 * green through an outage, which is the failure this endpoint exists to stop.
 * Here the warning is written by the real jobLogger into the real job_logs and
 * read back through the real queries.
 *
 * Each case runs inside a transaction that is rolled back, so the seeded rows
 * are never visible to the other integration tests sharing the database.
 */
import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { initJobLogger, stopJobLogger, logWarn, flush } from '../services/jobLogger.js';
import { classifyProviderError } from '../services/providerErrors.js';
import { createCollectionHealthRouter } from '../routes/collectionHealth.js';

// The password comes from the environment with no inline fallback: the test
// image sets PGPASSWORD, and a committed default would be a plaintext
// credential (constitution XVII, web-application profile) (PR #917 review).
const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD
});

afterAll(async () => {
  await stopJobLogger();
  await pool.end();
});

// What serperService throws when the account is empty, verbatim from the
// warnings job 575 left on 2026-11-02 (#888).
const OUT_OF_CREDITS = new Error('Serper API error (news): 400 - {"message":"Not enough credits"}');

/** A completed run of `pipeline`, finished `minutesAgo`, as the collector leaves it. */
async function seedRun(client, pipeline, totalPois, minutesAgo = 30) {
  // job_type is varchar and pipeline is text, so they cannot share a parameter.
  const { rows } = await client.query(
    `INSERT INTO news_job_status (job_type, pipeline, status, started_at, completed_at, total_pois, pois_processed)
     VALUES ($1, $2, 'completed', NOW() - $3::interval, NOW() - $4::interval, $5, $5)
     RETURNING id`,
    [pipeline, pipeline, `${minutesAgo + 10} minutes`, `${minutesAgo} minutes`, totalPois]
  );
  return rows[0].id;
}

/** GET /api/health/collection, reading `client` as its pool. */
function get(client) {
  const app = express();
  app.use('/api/health/collection', createCollectionHealthRouter(client));
  return request(app).get('/api/health/collection');
}

async function inTransaction(run) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await run(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('GET /api/health/collection against the real schema', () => {
  it('goes CRITICAL and names Serper when the search ran out of credits', async () => {
    await inTransaction(async (client) => {
      const jobId = await seedRun(client, 'current_news', 10);
      await seedRun(client, 'events', 10);

      // The Phase II catch in newsService: classify, then log the warning. The
      // job itself still ends 'completed' with nothing found, as it did for the
      // eleven days nobody noticed.
      initJobLogger(client);
      logWarn(jobId, 'news', 101, 'Boston Mill', `Phase II: Search failed: ${OUT_OF_CREDITS.message}`,
        classifyProviderError(OUT_OF_CREDITS));
      await flush();

      const stored = await client.query('SELECT details FROM job_logs WHERE job_id = $1', [jobId]);
      expect(stored.rows[0].details).toEqual({ provider: 'serper', error_class: 'quota_exhausted' });

      const res = await get(client);
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('CRITICAL');
      expect(res.body.message).toContain('serper quota_exhausted');
      expect(res.body.message).toContain('Not enough credits');
    });
  });

  it('goes CRITICAL and names OpenRouter when the key is revoked', async () => {
    await inTransaction(async (client) => {
      const jobId = await seedRun(client, 'current_news', 10);
      await seedRun(client, 'events', 10);

      // A revoked key throws on every POI, and BatchRunner catches each one, so
      // the job still ends 'completed'. The outer catch in collectPoi is what
      // has to carry the class.
      const revoked = new Error('Invalid OpenRouter API key: {"error":{"code":401,"message":"No auth credentials found"}}');
      initJobLogger(client);
      logWarn(jobId, 'news', 101, 'Boston Mill', `Error collecting news: ${revoked.message}`,
        classifyProviderError(revoked));
      await flush();

      const res = await get(client);
      expect(res.status).toBe(503);
      expect(res.body.message).toContain('openrouter auth_failed');
    });
  });

  it('goes CRITICAL when the search failed for more than half the POIs', async () => {
    await inTransaction(async (client) => {
      const jobId = await seedRun(client, 'current_news', 4);
      await seedRun(client, 'events', 4);

      // A failure the classifier does not recognise still has to show up once
      // it swallows most of the run.
      initJobLogger(client);
      for (const poiId of [101, 102, 103]) {
        logWarn(jobId, 'news', poiId, `POI ${poiId}`, 'Phase II: Search failed: socket hang up', null);
      }
      await flush();

      const res = await get(client);
      expect(res.status).toBe(503);
      expect(res.body.message).toContain('search failed for 3 of 4 POIs');
    });
  });

  it('is OK when both pipelines ran cleanly', async () => {
    await inTransaction(async (client) => {
      await seedRun(client, 'current_news', 10);
      await seedRun(client, 'events', 10);

      const res = await get(client);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'OK', message: 'collection ok' });
    });
  });

  it('warns when the last run is older than the daily cadence', async () => {
    await inTransaction(async (client) => {
      await seedRun(client, 'current_news', 10, 27 * 60);
      await seedRun(client, 'events', 10);

      const res = await get(client);
      expect(res.status).toBe(409);
      expect(res.body.status).toBe('WARNING');
      expect(res.body.message).toContain('current_news: no run in 27h');
    });
  });
});
