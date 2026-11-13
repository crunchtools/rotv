import express from 'express';

const PIPELINES = ['current_news', 'events'];
const STALE_HOURS = 26;
const FAILURE_SHARE = 0.5;

/**
 * Verdict for one pipeline's last completed run.
 * @param {string} pipeline
 * @param {{completed_at: Date|string, total_pois: number}|null} run last completed run
 * @param {{provider: string, error_class: string, message: string}|null} providerError first quota/auth failure in the run
 * @param {number} searchFailures POIs whose search failed in the run
 * @param {Date} [now]
 * @returns {{pipeline: string, status: 'OK'|'WARNING'|'CRITICAL', message: string}}
 */
export function pipelineVerdict(pipeline, run, providerError, searchFailures, now = new Date()) {
  if (!run) return { pipeline, status: 'WARNING', message: `${pipeline}: no completed run` };
  if (providerError) {
    return {
      pipeline,
      status: 'CRITICAL',
      message: `${pipeline}: ${providerError.provider} ${providerError.error_class}: ${providerError.message}`
    };
  }
  const total = Number(run.total_pois) || 0;
  if (total > 0 && searchFailures / total > FAILURE_SHARE) {
    return { pipeline, status: 'CRITICAL', message: `${pipeline}: search failed for ${searchFailures} of ${total} POIs` };
  }
  const ageHours = (now - new Date(run.completed_at)) / 3600000;
  if (ageHours > STALE_HOURS) {
    return { pipeline, status: 'WARNING', message: `${pipeline}: no run in ${Math.floor(ageHours)}h` };
  }
  return { pipeline, status: 'OK', message: `${pipeline}: ok` };
}

async function checkPipeline(pool, pipeline) {
  const runResult = await pool.query(
    `SELECT id, completed_at, total_pois FROM news_job_status
     WHERE pipeline = $1 AND status = 'completed'
     ORDER BY completed_at DESC NULLS LAST LIMIT 1`,
    [pipeline]
  );
  const run = runResult.rows[0] || null;
  if (!run) return pipelineVerdict(pipeline, null, null, 0);

  const errorResult = await pool.query(
    `SELECT details->>'provider' AS provider, details->>'error_class' AS error_class, message
     FROM job_logs
     WHERE job_type = 'news' AND job_id = $1 AND details->>'error_class' IN ('quota_exhausted', 'auth_failed')
     ORDER BY id LIMIT 1`,
    [run.id]
  );
  const failureResult = await pool.query(
    `SELECT COUNT(DISTINCT poi_id)::int AS n FROM job_logs
     WHERE job_type = 'news' AND job_id = $1 AND message LIKE 'Phase II: Search failed%'`,
    [run.id]
  );
  return pipelineVerdict(pipeline, run, errorResult.rows[0] || null, failureResult.rows[0].n);
}

/**
 * Collection health for Nagios, mounted at /api/health/collection.
 * 200 when every pipeline is OK, 409 for WARNING (check_http reads 4xx as
 * WARNING), 503 for CRITICAL (5xx).
 * @param {import('pg').Pool} pool
 * @returns {import('express').Router}
 */
export function createCollectionHealthRouter(pool) {
  const router = express.Router();
  router.get('/', async (_req, res) => {
    try {
      const verdicts = await Promise.all(PIPELINES.map(p => checkPipeline(pool, p)));
      const worst = verdicts.some(v => v.status === 'CRITICAL') ? 'CRITICAL'
        : verdicts.some(v => v.status === 'WARNING') ? 'WARNING' : 'OK';
      const message = verdicts.filter(v => v.status !== 'OK').map(v => v.message).join('; ') || 'collection ok';
      res.status(worst === 'OK' ? 200 : worst === 'WARNING' ? 409 : 503)
        .json({ status: worst, message, pipelines: verdicts });
    } catch (error) {
      res.status(503).json({ status: 'CRITICAL', message: `collection health check failed: ${error.message}` });
    }
  });
  return router;
}
