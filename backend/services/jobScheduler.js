import { PgBoss } from 'pg-boss';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('JobScheduler');
const pgBossLogger = createLogger('pg-boss');
const jitterLogger = createLogger('Jitter');

let boss = null;

const JOB_NAMES = {
  NEWS_COLLECTION: 'news-collection',
  NEWS_COLLECTION_DAILY: 'news-collection-daily',
  NEWS_COLLECTION_WEEKLY: 'news-collection-weekly',
  NEWS_COLLECTION_MONTHLY: 'news-collection-monthly',
  NEWS_COLLECTION_POI: 'news-collection-poi',
  CURRENT_NEWS: 'news-current',
  HISTORICAL_NEWS: 'news-historical',
  EVENTS_COLLECTION: 'events-collection',
  NEWS_BATCH: 'news-batch-collection',
  TRAIL_STATUS_COLLECTION: 'trail-status-collection',
  TRAIL_STATUS_BATCH: 'trail-status-batch-collect',
  RIVER_LEVELS_COLLECTION: 'river-levels-collection',
  CONTENT_MODERATION: 'content-moderation',
  CONTENT_MODERATION_SWEEP: 'content-moderation-sweep',
  NEWSLETTER_PROCESS: 'newsletter-process',
  NEWSLETTER_DIGEST: 'newsletter-digest',
  NEWSLETTER_PREVIEW: 'newsletter-preview',
  IMAGE_BACKUP: 'image-backup',
  DATABASE_BACKUP: 'database-backup'
};

export async function initJobScheduler(connectionString) {
  if (boss) {
    return boss;
  }

  boss = new PgBoss(connectionString);

  boss.on('error', error => logger.error('pg-boss error:', error));

  await boss.start();
  logger.info('Job scheduler started');

  return boss;
}

export function getJobScheduler() {
  if (!boss) {
    throw new Error('Job scheduler not initialized. Call initJobScheduler first.');
  }
  return boss;
}

// pg-boss queues must exist before work() is attached. A failure here is logged
// rather than thrown: the queue normally already exists from a previous boot.
async function ensureQueue(scheduler, queueName) {
  try {
    await scheduler.createQueue(queueName);
    logger.info(`Queue '${queueName}' created`);
  } catch (error) {
    if (error.message?.includes('already exists')) {
      logger.debug(`Queue '${queueName}' already exists`);
    } else {
      logger.warn(`Queue '${queueName}' could not be created, assuming it exists: ${error.message}`);
    }
  }
}

async function scheduleCron(jobName, cronExpression, label, data = {}) {
  const scheduler = getJobScheduler();
  await scheduler.schedule(jobName, cronExpression, data, { tz: 'America/New_York' });
  logger.info(`${label} scheduled with cron: ${cronExpression}`);
}

// Attach a worker that runs `run(job)` for every job pg-boss delivers (it may hand
// over a single job or a batch), logging start/finish and rethrowing failures so
// pg-boss applies its retry policy.
async function registerWorker(jobName, label, run, { workOptions = {}, log = logger } = {}) {
  const scheduler = getJobScheduler();
  await ensureQueue(scheduler, jobName);

  await scheduler.work(jobName, workOptions, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      log.info(`Starting ${label} job: ${job.id}`);
      try {
        await run(job);
        log.info(`${label} job completed: ${job.id}`);
      } catch (error) {
        log.error(`${label} job failed (${job.id}):`, error);
        throw error;
      }
    }
  });
}

async function sendManualJob(jobName, data = {}, sendOptions = undefined) {
  const scheduler = getJobScheduler();
  return scheduler.send(jobName, {
    ...data,
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  }, sendOptions);
}

export async function scheduleNewsCollection(cronExpression = '0 6 * * *') {
  await scheduleCron(JOB_NAMES.NEWS_COLLECTION, cronExpression, 'News collection');
}

// Current News, Historical News, and Events replace the three tier jobs (spec 044).
const PIPELINE_JOB_NAMES = {
  current_news: JOB_NAMES.CURRENT_NEWS,
  historical_news: JOB_NAMES.HISTORICAL_NEWS,
  events: JOB_NAMES.EVENTS_COLLECTION
};

export const RETIRED_TIER_JOB_NAMES = [
  JOB_NAMES.NEWS_COLLECTION_DAILY,
  JOB_NAMES.NEWS_COLLECTION_WEEKLY,
  JOB_NAMES.NEWS_COLLECTION_MONTHLY
];

export async function schedulePipelineCollection(pipeline, cronExpression) {
  const jobName = PIPELINE_JOB_NAMES[pipeline];
  if (!jobName) throw new Error(`Invalid pipeline: ${pipeline}`);
  await scheduleCron(jobName, cronExpression, `${pipeline} collection`, { pipeline });
}

export async function registerPipelineCollectionHandler(pipeline, handler) {
  const jobName = PIPELINE_JOB_NAMES[pipeline];
  if (!jobName) throw new Error(`Invalid pipeline: ${pipeline}`);
  await registerWorker(jobName, `${pipeline} collection`, job => handler(job.data));
}

export async function unscheduleJob(jobName) {
  const scheduler = getJobScheduler();
  await scheduler.unschedule(jobName);
}

export async function registerNewsCollectionHandler(handler) {
  await registerWorker(JOB_NAMES.NEWS_COLLECTION, 'news collection', job => handler(job.data));
}

export async function getJobStatus(jobId) {
  const scheduler = getJobScheduler();
  return scheduler.getJobById(jobId);
}

export async function registerBatchNewsHandler(handler) {
  await registerWorker(JOB_NAMES.NEWS_BATCH, 'batch news collection', job => handler(job.id, job.data), {
    workOptions: { newJobCheckIntervalSeconds: 1 },
    log: pgBossLogger
  });
}

const NEWS_BATCH_RETRY = { retryLimit: 2, retryDelay: 30, expireInMinutes: 60 };
const NEWSLETTER_RETRY = { retryLimit: 2, retryDelay: 60, expireInMinutes: 30 };

export async function submitBatchNewsJob({ jobId, poiIds = null } = {}) {
  const pgBossJobId = await sendManualJob(JOB_NAMES.NEWS_BATCH, { jobId, poiIds: poiIds || null }, NEWS_BATCH_RETRY);
  pgBossLogger.info(`Batch news collection job submitted: ${pgBossJobId}`);
  return pgBossJobId;
}

export async function scheduleTrailStatusCollection(cronExpression = '*/30 * * * *') {
  await scheduleCron(JOB_NAMES.TRAIL_STATUS_COLLECTION, cronExpression, 'Trail status collection');
}

export async function registerTrailStatusHandler(handler) {
  await registerWorker(JOB_NAMES.TRAIL_STATUS_COLLECTION, 'trail status collection', job => handler(job.data));
}

export async function registerBatchTrailStatusHandler(handler) {
  await registerWorker(JOB_NAMES.TRAIL_STATUS_BATCH, 'batch trail status collection',
    job => handler(job.data.jobId, job.data.poiIds), {
      workOptions: { newJobCheckIntervalSeconds: 1 },
      log: pgBossLogger
    });
}

export async function scheduleRiverLevelsCollection(cronExpression = '0 * * * *') {
  await scheduleCron(JOB_NAMES.RIVER_LEVELS_COLLECTION, cronExpression, 'River levels collection');
}

export async function registerRiverLevelsHandler(handler) {
  await registerWorker(JOB_NAMES.RIVER_LEVELS_COLLECTION, 'river levels collection', job => handler(job.data));
}

export async function scheduleModerationSweep(cronExpression = '0 7 * * *') {
  await scheduleCron(JOB_NAMES.CONTENT_MODERATION_SWEEP, cronExpression, 'Moderation sweep');
}

export async function registerModerationSweepHandler(handler) {
  await registerWorker(JOB_NAMES.CONTENT_MODERATION_SWEEP, 'moderation sweep', () => handler());
}

export async function registerNewsletterHandler(handler) {
  await registerWorker(JOB_NAMES.NEWSLETTER_PROCESS, 'newsletter processing',
    job => handler(job.data.emailId), { log: pgBossLogger });
}

export async function queueNewsletterJob(emailId) {
  const scheduler = getJobScheduler();
  return scheduler.send(JOB_NAMES.NEWSLETTER_PROCESS, { emailId, queuedAt: new Date().toISOString() }, NEWSLETTER_RETRY);
}

export async function scheduleImageBackup(cronExpression = '0 2 * * *') {
  await scheduleCron(JOB_NAMES.IMAGE_BACKUP, cronExpression, 'Image backup');
}

export async function registerImageBackupHandler(handler) {
  await registerWorker(JOB_NAMES.IMAGE_BACKUP, 'image backup', job => handler(job.data));
}

export async function scheduleDatabaseBackup(cronExpression = '0 3 * * *') {
  await scheduleCron(JOB_NAMES.DATABASE_BACKUP, cronExpression, 'Database backup');
}

export async function registerDatabaseBackupHandler(handler) {
  await registerWorker(JOB_NAMES.DATABASE_BACKUP, 'database backup', job => handler(job.data));
}

export async function updateSchedule(jobName, cronExpression) {
  const scheduler = getJobScheduler();
  await scheduler.schedule(jobName, cronExpression, {}, { tz: 'America/New_York' });
  logger.info(`Schedule updated: ${jobName} → ${cronExpression}`);
}

export async function registerDigestHandler(handler) {
  await registerWorker(JOB_NAMES.NEWSLETTER_DIGEST, 'newsletter digest', job => handler(job.id, job.data));
}

export async function scheduleDigest(cronExpression = '0 8 * * 5') {
  await scheduleCron(JOB_NAMES.NEWSLETTER_DIGEST, cronExpression, 'Newsletter digest');
}

export async function registerPreviewHandler(handler) {
  await registerWorker(JOB_NAMES.NEWSLETTER_PREVIEW, 'newsletter preview', job => handler(job.id, job.data));
}

export async function schedulePreview(cronExpression = '0 8 * * 4') {
  await scheduleCron(JOB_NAMES.NEWSLETTER_PREVIEW, cronExpression, 'Newsletter preview');
}

export async function triggerDigestManually() {
  const jobId = await sendManualJob(JOB_NAMES.NEWSLETTER_DIGEST);
  logger.info('Manual digest send triggered, job ID:', jobId);
  return jobId;
}

export async function triggerPreviewManually() {
  const jobId = await sendManualJob(JOB_NAMES.NEWSLETTER_PREVIEW);
  logger.info('Manual preview send triggered, job ID:', jobId);
  return jobId;
}

export async function stopJobScheduler() {
  if (boss) {
    await boss.stop();
    boss = null;
    logger.info('Job scheduler stopped');
  }
}

export function withJitter(handler, jobName, minSeconds = 1, maxSeconds = 60) {
  return async (...args) => {
    const delay = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
    jitterLogger.info(`${jobName} delayed by ${delay}s`);
    await new Promise(resolve => setTimeout(resolve, delay * 1000));
    return handler(...args);
  };
}

export { JOB_NAMES };
