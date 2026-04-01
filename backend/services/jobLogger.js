/**
 * Job Logger Service
 * Batch-insert structured log entries for collection jobs.
 * Buffers entries in memory, flushes periodically or on demand.
 * Best-effort — never blocks or crashes the calling job.
 */

let pool = null;
let buffer = [];
let flushTimer = null;

const FLUSH_INTERVAL_MS = 5000;
const BATCH_SIZE = 50;

/**
 * Initialize the job logger with a database pool
 * @param {Pool} dbPool - PostgreSQL connection pool
 */
export function initJobLogger(dbPool) {
  pool = dbPool;
  flushTimer = setInterval(() => {
    if (buffer.length > 0) flush();
  }, FLUSH_INTERVAL_MS);
  console.log('[JobLogger] Initialized');
}

/**
 * Stop the job logger — flush remaining entries and clear timer
 */
export async function stopJobLogger() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (buffer.length > 0) {
    await flush();
  }
  console.log('[JobLogger] Stopped');
}

/**
 * Log a structured entry. Non-blocking, fire-and-forget.
 * @param {Object} entry
 * @param {number} entry.jobId - Job ID from status table
 * @param {string} entry.jobType - 'news', 'trail_status', 'moderation', 'newsletter', 'backup'
 * @param {number|null} entry.poiId - POI ID if applicable
 * @param {string|null} entry.poiName - POI name for display
 * @param {string} entry.level - 'info', 'warn', 'error'
 * @param {string} entry.message - Log message
 * @param {Object|null} entry.details - Optional JSONB details
 */
export function log(entry) {
  buffer.push({
    jobId: entry.jobId || 0,
    jobType: entry.jobType || 'unknown',
    poiId: entry.poiId || null,
    poiName: entry.poiName || null,
    level: entry.level || 'info',
    message: entry.message || '',
    details: entry.details || null
  });

  if (buffer.length >= BATCH_SIZE) {
    flush();
  }
}

/**
 * Convenience: log an info entry
 */
export function logInfo(jobId, jobType, poiId, poiName, message, details = null) {
  log({ jobId, jobType, poiId, poiName, level: 'info', message, details });
}

/**
 * Convenience: log a warning entry
 */
export function logWarn(jobId, jobType, poiId, poiName, message, details = null) {
  log({ jobId, jobType, poiId, poiName, level: 'warn', message, details });
}

/**
 * Convenience: log an error entry
 */
export function logError(jobId, jobType, poiId, poiName, message, details = null) {
  log({ jobId, jobType, poiId, poiName, level: 'error', message, details });
}

/**
 * Flush buffered entries to the database via multi-row INSERT.
 * Best-effort — swallows errors to avoid disrupting calling jobs.
 */
export async function flush() {
  if (!pool || buffer.length === 0) return;

  const entries = buffer.splice(0);

  try {
    const values = [];
    const placeholders = [];
    let idx = 1;

    for (const entry of entries) {
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`);
      values.push(
        entry.jobId,
        entry.jobType,
        entry.poiId,
        entry.poiName,
        entry.level,
        entry.message,
        entry.details ? JSON.stringify(entry.details) : null
      );
      idx += 7;
    }

    await pool.query(`
      INSERT INTO job_logs (job_id, job_type, poi_id, poi_name, level, message, details)
      VALUES ${placeholders.join(', ')}
    `, values);
  } catch (error) {
    console.error('[JobLogger] Flush failed:', error.message);
    // Don't re-buffer — drop entries to avoid infinite loops
  }
}
