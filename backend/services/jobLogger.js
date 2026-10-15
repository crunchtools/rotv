import { createLogger } from '../utils/logger.js';

const logger = createLogger('JobLogger');

const jobTypeLoggers = new Map();

function loggerFor(jobType) {
  const tag = jobType || 'Job';
  if (!jobTypeLoggers.has(tag)) jobTypeLoggers.set(tag, createLogger(tag));
  return jobTypeLoggers.get(tag);
}

let pool = null;
let buffer = [];
let flushTimer = null;

const FLUSH_INTERVAL_MS = 5000;
const BATCH_SIZE = 50;

export function initJobLogger(dbPool) {
  pool = dbPool;
  // Fix: clear existing timer before creating new one to prevent leaks (PR #166 review)
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => {
    if (buffer.length > 0) flush();
  }, FLUSH_INTERVAL_MS);
  logger.info('Initialized');
}

export async function stopJobLogger() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (buffer.length > 0) {
    await flush();
  }
  logger.info('Stopped');
}

// PostgreSQL refuses the NUL character in text and JSON, and scraped pages carry it.
const withoutNul = (value) => (typeof value === 'string' ? value.replaceAll('\u0000', '') : value);

// A value cut to its column's length, so one long news title cannot fail the batch.
const fit = (value, length) => {
  const text = withoutNul(value);
  return typeof text === 'string' && text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

/**
 * Queue one entry for the next flush. Every field is made to fit job_logs, as
 * one entry the table refuses would lose the whole batch it is flushed with.
 * @param {{jobId?: number, jobType?: string, poiId?: number, poiName?: string,
 *   level?: string, message?: string, details?: object}} entry
 */
export function log(entry) {
  // Details as JSONB will store them: serialized as usual (a Date becomes its
  // ISO string), and rebuilt without NUL, keys included, only when one is there.
  const json = entry.details == null ? null : JSON.stringify(entry.details);
  const details = json?.includes('\\u0000') ? JSON.parse(json.replaceAll('\\u0000', '')) : (entry.details ?? null);
  buffer.push({
    jobId: entry.jobId || 0,
    jobType: fit(entry.jobType || 'unknown', 50),
    poiId: entry.poiId || null,
    poiName: fit(entry.poiName || null, 255),
    level: fit(entry.level || 'info', 10),
    message: withoutNul(entry.message || ''),
    details
  });

  if (buffer.length >= BATCH_SIZE) {
    flush();
  }
}

export function logInfo(jobId, jobType, poiId, poiName, message, details = null) {
  loggerFor(jobType).info(message);
  log({ jobId, jobType, poiId, poiName, level: 'info', message, details });
}

export function logWarn(jobId, jobType, poiId, poiName, message, details = null) {
  loggerFor(jobType).warn(message);
  log({ jobId, jobType, poiId, poiName, level: 'warn', message, details });
}

export function logError(jobId, jobType, poiId, poiName, message, details = null) {
  loggerFor(jobType).error(message);
  log({ jobId, jobType, poiId, poiName, level: 'error', message, details });
}

export async function flush() {
  if (!pool || buffer.length === 0) return;

  const entries = buffer.splice(0);

  try {
    const values = [];
    const placeholders = [];
    let idx = 1;

    for (const entry of entries) {
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`);
      // node-postgres handles JS objects natively for JSONB columns —
      // manual JSON.stringify would cause double-encoding
      values.push(
        entry.jobId,
        entry.jobType,
        entry.poiId,
        entry.poiName,
        entry.level,
        entry.message,
        entry.details || null
      );
      idx += 7;
    }

    await pool.query(`
      INSERT INTO job_logs (job_id, job_type, poi_id, poi_name, level, message, details)
      VALUES ${placeholders.join(', ')}
    `, values);
  } catch (error) {
    logger.error('Flush failed:', error.message);
  }
}
