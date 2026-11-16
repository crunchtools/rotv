/**
 * Collection health (#888): an out-of-credits response from a paid provider
 * must turn the Nagios check CRITICAL, naming the provider, rather than end the
 * run as a silent "completed" with zero items.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { complete } from '../services/llmService.js';
import { classifyProviderError } from '../services/providerErrors.js';
import { createCollectionHealthRouter } from '../routes/collectionHealth.js';

vi.mock('../services/jobLogger.js', () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), flush: vi.fn() }));

const recent = () => new Date(Date.now() - 3600000).toISOString();

/** A pool whose job_logs hold `providerError` for every pipeline's last run. */
function poolWith(providerError, searchFailures = 0) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes('FROM news_job_status')) return { rows: [{ id: 42, completed_at: recent(), total_pois: 10 }] };
      if (sql.includes("details->>'error_class'")) return { rows: providerError ? [providerError] : [] };
      return { rows: [{ n: searchFailures }] };
    })
  };
}

const appWith = (pool) => {
  const app = express();
  app.use('/api/health/collection', createCollectionHealthRouter(pool));
  return app;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('collection health', () => {
  it('goes CRITICAL with the provider named when OpenRouter is out of credits', async () => {
    // The real llmService path: OpenRouter answers 402, complete() throws, and
    // the error it throws is what newsService records in job_logs.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 402,
      ok: false,
      headers: new Headers(),
      text: async () => '{"error":{"code":402,"message":"Insufficient credits"}}'
    }));
    const keyPool = { query: vi.fn().mockResolvedValue({ rows: [{ value: 'sk-or-test' }] }) };
    const error = await complete(keyPool, 'x').catch(e => e);
    const details = classifyProviderError(error);
    expect(details).toEqual({ provider: 'openrouter', error_class: 'quota_exhausted' });

    const res = await request(appWith(poolWith({ ...details, message: error.message }))).get('/api/health/collection');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('CRITICAL');
    expect(res.body.message).toContain('openrouter quota_exhausted');
  });

  it('goes CRITICAL when Serper is out of credits', async () => {
    const error = new Error('Serper API error (news): 400 - {"message":"Not enough credits"}');
    const res = await request(appWith(poolWith({ ...classifyProviderError(error), message: error.message })))
      .get('/api/health/collection');
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('serper quota_exhausted');
  });

  it('is OK for a healthy run', async () => {
    const res = await request(appWith(poolWith(null, 1))).get('/api/health/collection');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });

  it('is CRITICAL, without detail, when the database cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(appWith({ query: vi.fn().mockRejectedValue(new Error('db down')) }))
      .get('/api/health/collection');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'CRITICAL', message: 'collection health check failed' });
  });
});
