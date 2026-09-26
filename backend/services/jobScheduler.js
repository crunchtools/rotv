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

export async function scheduleNewsCollection(cronExpression = '0 6 * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.NEWS_COLLECTION, cronExpression, {}, {
    tz: 'America/New_York'
  });

  logger.info(`News collection scheduled with cron: ${cronExpression}`);
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
  const scheduler = getJobScheduler();
  await scheduler.schedule(jobName, cronExpression, { pipeline }, { tz: 'America/New_York' });
  logger.info(`${pipeline} collection scheduled with cron: ${cronExpression}`);
}

export async function registerPipelineCollectionHandler(pipeline, handler) {
  const jobName = PIPELINE_JOB_NAMES[pipeline];
  if (!jobName) throw new Error(`Invalid pipeline: ${pipeline}`);
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(jobName);
    logger.info(`Queue '${jobName}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${jobName}' may already exist`);
    }
  }

  await scheduler.work(jobName, async (job) => {
    logger.info(`Starting ${pipeline} collection job:`, job.id);
    try {
      await handler(job.data);
      logger.info(`${pipeline} collection job completed:`, job.id);
    } catch (error) {
      logger.error(`${pipeline} collection job failed:`, error);
      throw error;
    }
  });
}

export async function unscheduleJob(jobName) {
  const scheduler = getJobScheduler();
  await scheduler.unschedule(jobName);
}

export async function registerNewsCollectionHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.NEWS_COLLECTION);
    logger.info(`Queue '${JOB_NAMES.NEWS_COLLECTION}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.NEWS_COLLECTION}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWS_COLLECTION, async (job) => {
    logger.info('Starting news collection job:', job.id);
    try {
      await handler(job.data);
      logger.info('News collection job completed:', job.id);
    } catch (error) {
      logger.error('News collection job failed:', error);
      throw error;
    }
  });
}

export async function registerPoiNewsHandler(handler) {
  const scheduler = getJobScheduler();

  await scheduler.work(JOB_NAMES.NEWS_COLLECTION_POI, {
    teamSize: 3,
    teamConcurrency: 1
  }, async (job) => {
    try {
      await handler(job.data);
    } catch (error) {
      logger.error(`News collection failed for POI ${job.data.poiId}:`, error);
      throw error;
    }
  });
}

export async function triggerNewsCollection() {
  const scheduler = getJobScheduler();

  const jobId = await scheduler.send(JOB_NAMES.NEWS_COLLECTION, {
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  });

  logger.info('Manual news collection triggered, job ID:', jobId);
  return jobId;
}

export async function queuePoiNewsCollection(poiId, poiName) {
  const scheduler = getJobScheduler();

  return scheduler.send(JOB_NAMES.NEWS_COLLECTION_POI, {
    poiId,
    poiName,
    queuedAt: new Date().toISOString()
  });
}

export async function getJobStatus(jobId) {
  const scheduler = getJobScheduler();
  return scheduler.getJobById(jobId);
}

export async function registerBatchNewsHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.NEWS_BATCH);
    logger.info(`Queue '${JOB_NAMES.NEWS_BATCH}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.NEWS_BATCH}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWS_BATCH, {
    newJobCheckIntervalSeconds: 1
  }, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      pgBossLogger.info(`Starting batch news collection job: ${job.id}`);
      try {
        await handler(job.id, job.data);
        pgBossLogger.info(`Batch news collection job completed: ${job.id}`);
      } catch (error) {
        pgBossLogger.error(`Batch news collection job failed:`, error);
        throw error;
      }
    }
  });
}

export async function submitBatchNewsJob(options = {}) {
  const scheduler = getJobScheduler();

  const pgBossJobId = await scheduler.send(JOB_NAMES.NEWS_BATCH, {
    jobId: options.jobId,
    poiIds: options.poiIds || null,
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  }, {
    retryLimit: 2,
    retryDelay: 30,
    expireInMinutes: 60
  });

  pgBossLogger.info(`Batch news collection job submitted: ${pgBossJobId}`);
  return pgBossJobId;
}

export async function getBatchJobStatus(jobId) {
  const scheduler = getJobScheduler();
  return scheduler.getJobById(jobId);
}

export async function scheduleTrailStatusCollection(cronExpression = '*/30 * * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.TRAIL_STATUS_COLLECTION, cronExpression, {}, {
    tz: 'America/New_York'
  });

  logger.info(`Trail status collection scheduled with cron: ${cronExpression}`);
}

export async function registerTrailStatusHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.TRAIL_STATUS_COLLECTION);
    logger.info(`Queue '${JOB_NAMES.TRAIL_STATUS_COLLECTION}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.TRAIL_STATUS_COLLECTION}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.TRAIL_STATUS_COLLECTION, async (job) => {
    logger.info('Starting trail status collection job:', job.id);
    try {
      await handler(job.data);
      logger.info('Trail status collection job completed:', job.id);
    } catch (error) {
      logger.error('Trail status collection job failed:', error);
      throw error;
    }
  });
}

export async function registerBatchTrailStatusHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.TRAIL_STATUS_BATCH);
    logger.info(`Queue '${JOB_NAMES.TRAIL_STATUS_BATCH}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.TRAIL_STATUS_BATCH}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.TRAIL_STATUS_BATCH, {
    newJobCheckIntervalSeconds: 1
  }, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      pgBossLogger.info(`Starting batch trail status collection job: ${job.id}`);
      try {
        await handler(job.data.jobId, job.data.poiIds);
        pgBossLogger.info(`Batch trail status collection job completed: ${job.id}`);
      } catch (error) {
        pgBossLogger.error(`Batch trail status collection job failed:`, error);
        throw error;
      }
    }
  });
}

export async function scheduleRiverLevelsCollection(cronExpression = '0 * * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.RIVER_LEVELS_COLLECTION, cronExpression, {}, {
    tz: 'America/New_York'
  });

  logger.info(`River levels collection scheduled with cron: ${cronExpression}`);
}

export async function registerRiverLevelsHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.RIVER_LEVELS_COLLECTION);
    logger.info(`Queue '${JOB_NAMES.RIVER_LEVELS_COLLECTION}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.RIVER_LEVELS_COLLECTION}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.RIVER_LEVELS_COLLECTION, async (job) => {
    logger.info('Starting river levels collection job:', job.id);
    try {
      await handler(job.data);
      logger.info('River levels collection job completed:', job.id);
    } catch (error) {
      logger.error('River levels collection job failed:', error);
      throw error;
    }
  });
}

export async function triggerRiverLevelsCollection() {
  const scheduler = getJobScheduler();

  const jobId = await scheduler.send(JOB_NAMES.RIVER_LEVELS_COLLECTION, {
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  });

  logger.info('Manual river levels collection triggered, job ID:', jobId);
  return jobId;
}

export async function scheduleModerationSweep(cronExpression = '0 7 * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.CONTENT_MODERATION_SWEEP, cronExpression, {}, {
    tz: 'America/New_York'
  });

  logger.info(`Moderation sweep scheduled with cron: ${cronExpression}`);
}

export async function registerModerationSweepHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.CONTENT_MODERATION_SWEEP);
    logger.info(`Queue '${JOB_NAMES.CONTENT_MODERATION_SWEEP}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.CONTENT_MODERATION_SWEEP}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.CONTENT_MODERATION_SWEEP, async (job) => {
    logger.info('Starting moderation sweep job:', job.id);
    try {
      await handler();
      logger.info('Moderation sweep job completed:', job.id);
    } catch (error) {
      logger.error('Moderation sweep job failed:', error);
      throw error;
    }
  });
}

export async function registerNewsletterHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.NEWSLETTER_PROCESS);
    logger.info(`Queue '${JOB_NAMES.NEWSLETTER_PROCESS}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.NEWSLETTER_PROCESS}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWSLETTER_PROCESS, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      try {
        await handler(job.data.emailId);
      } catch (error) {
        pgBossLogger.error(`Newsletter processing failed for email #${job.data.emailId}:`, error.message);
        throw error;
      }
    }
  });
}

export async function queueNewsletterJob(emailId) {
  const scheduler = getJobScheduler();

  return scheduler.send(JOB_NAMES.NEWSLETTER_PROCESS, {
    emailId,
    queuedAt: new Date().toISOString()
  }, {
    retryLimit: 2,
    retryDelay: 60,
    expireInMinutes: 30
  });
}

export async function scheduleImageBackup(cronExpression = '0 2 * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.IMAGE_BACKUP, cronExpression, {}, {
    tz: 'America/New_York'
  });

  logger.info(`Image backup scheduled with cron: ${cronExpression}`);
}

export async function registerImageBackupHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.IMAGE_BACKUP);
    logger.info(`Queue '${JOB_NAMES.IMAGE_BACKUP}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.IMAGE_BACKUP}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.IMAGE_BACKUP, async (job) => {
    logger.info('Starting image backup job:', job.id);
    try {
      await handler(job.data);
      logger.info('Image backup job completed:', job.id);
    } catch (error) {
      logger.error('Image backup job failed:', error);
      throw error;
    }
  });
}

export async function submitImageBackupJob() {
  const scheduler = getJobScheduler();

  const jobId = await scheduler.send(JOB_NAMES.IMAGE_BACKUP, {
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  }, {
    retryLimit: 2,
    retryDelay: 60,
    expireInMinutes: 120
  });

  pgBossLogger.info(`Image backup job submitted: ${jobId}`);
  return jobId;
}

export async function scheduleDatabaseBackup(cronExpression = '0 3 * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.DATABASE_BACKUP, cronExpression, {}, {
    tz: 'America/New_York'
  });

  logger.info(`Database backup scheduled with cron: ${cronExpression}`);
}

export async function registerDatabaseBackupHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.DATABASE_BACKUP);
    logger.info(`Queue '${JOB_NAMES.DATABASE_BACKUP}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.DATABASE_BACKUP}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.DATABASE_BACKUP, async (job) => {
    logger.info('Starting database backup job:', job.id);
    try {
      await handler(job.data);
      logger.info('Database backup job completed:', job.id);
    } catch (error) {
      logger.error('Database backup job failed:', error);
      throw error;
    }
  });
}

export async function updateSchedule(jobName, cronExpression) {
  const scheduler = getJobScheduler();
  await scheduler.schedule(jobName, cronExpression, {}, { tz: 'America/New_York' });
  logger.info(`Schedule updated: ${jobName} → ${cronExpression}`);
}

export async function registerDigestHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.NEWSLETTER_DIGEST);
    logger.info(`Queue '${JOB_NAMES.NEWSLETTER_DIGEST}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.NEWSLETTER_DIGEST}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWSLETTER_DIGEST, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      logger.info('Starting newsletter digest job:', job.id);
      try {
        await handler(job.id, job.data);
        logger.info('Newsletter digest sent successfully:', job.id);
      } catch (error) {
        logger.error('Newsletter digest job failed:', error);
        throw error;
      }
    }
  });
}

export async function scheduleDigest(cronExpression = '0 8 * * 5') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.NEWSLETTER_DIGEST, cronExpression, {}, {
    tz: 'America/New_York'
  });

  logger.info(`Newsletter digest scheduled with cron: ${cronExpression}`);
}

export async function registerPreviewHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.NEWSLETTER_PREVIEW);
    logger.info(`Queue '${JOB_NAMES.NEWSLETTER_PREVIEW}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      logger.info(`Queue '${JOB_NAMES.NEWSLETTER_PREVIEW}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWSLETTER_PREVIEW, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      logger.info('Starting newsletter preview job:', job.id);
      try {
        await handler(job.id, job.data);
        logger.info('Newsletter preview sent successfully:', job.id);
      } catch (error) {
        logger.error('Newsletter preview job failed:', error);
        throw error;
      }
    }
  });
}

export async function schedulePreview(cronExpression = '0 8 * * 4') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.NEWSLETTER_PREVIEW, cronExpression, {}, {
    tz: 'America/New_York'
  });

  logger.info(`Newsletter preview scheduled with cron: ${cronExpression}`);
}

export async function triggerDigestManually() {
  const scheduler = getJobScheduler();

  const jobId = await scheduler.send(JOB_NAMES.NEWSLETTER_DIGEST, {
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  });

  logger.info('Manual digest send triggered, job ID:', jobId);
  return jobId;
}

export async function triggerPreviewManually() {
  const scheduler = getJobScheduler();

  const jobId = await scheduler.send(JOB_NAMES.NEWSLETTER_PREVIEW, {
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  });

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
