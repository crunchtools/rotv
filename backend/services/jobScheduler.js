/**
 * Job Scheduler Service
 * Uses pg-boss for reliable job scheduling with PostgreSQL
 */

import { PgBoss } from 'pg-boss';

let boss = null;

const JOB_NAMES = {
  NEWS_COLLECTION: 'news-collection',           // Scheduled daily collection
  NEWS_COLLECTION_POI: 'news-collection-poi',   // Individual POI processing
  NEWS_BATCH: 'news-batch-collection',          // Admin-triggered batch collection
  TRAIL_STATUS_COLLECTION: 'trail-status-collection',  // Scheduled trail status collection
  TRAIL_STATUS_BATCH: 'trail-status-batch-collect',    // Admin-triggered trail status batch
  CONTENT_MODERATION: 'content-moderation',            // LLM moderation for individual items
  CONTENT_MODERATION_SWEEP: 'content-moderation-sweep', // Scheduled sweep for unprocessed items
  NEWSLETTER_PROCESS: 'newsletter-process',              // Process inbound newsletter email
  IMAGE_BACKUP: 'image-backup',                           // Scheduled image server backup to Drive
  DATABASE_BACKUP: 'database-backup'                      // Scheduled database backup to Drive
};

/**
 * Initialize the job scheduler
 * @param {string} connectionString - PostgreSQL connection string
 */
export async function initJobScheduler(connectionString) {
  if (boss) {
    return boss;
  }

  boss = new PgBoss(connectionString);

  boss.on('error', error => console.error('pg-boss error:', error));

  await boss.start();
  console.log('Job scheduler started');

  return boss;
}

/**
 * Get the pg-boss instance
 */
export function getJobScheduler() {
  if (!boss) {
    throw new Error('Job scheduler not initialized. Call initJobScheduler first.');
  }
  return boss;
}

/**
 * Schedule the daily news collection job
 * @param {string} cronExpression - Cron expression (default: 6 AM daily)
 */
export async function scheduleNewsCollection(cronExpression = '0 6 * * *') {
  const scheduler = getJobScheduler();

  // Create a schedule for the news collection job
  await scheduler.schedule(JOB_NAMES.NEWS_COLLECTION, cronExpression, {}, {
    tz: 'America/New_York'
  });

  console.log(`News collection scheduled with cron: ${cronExpression}`);
}

/**
 * Register the news collection job handler
 * @param {Function} handler - Async function to handle the job
 */
export async function registerNewsCollectionHandler(handler) {
  const scheduler = getJobScheduler();

  // Create the queue if it doesn't exist (required in pg-boss v12+)
  try {
    await scheduler.createQueue(JOB_NAMES.NEWS_COLLECTION);
    console.log(`Queue '${JOB_NAMES.NEWS_COLLECTION}' created`);
  } catch (error) {
    // Queue might already exist, that's fine
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.NEWS_COLLECTION}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWS_COLLECTION, async (job) => {
    console.log('Starting news collection job:', job.id);
    try {
      await handler(job.data);
      console.log('News collection job completed:', job.id);
    } catch (error) {
      console.error('News collection job failed:', error);
      throw error; // Re-throw to mark job as failed
    }
  });
}

/**
 * Register handler for individual POI news collection
 * @param {Function} handler - Async function to handle per-POI collection
 */
export async function registerPoiNewsHandler(handler) {
  const scheduler = getJobScheduler();

  await scheduler.work(JOB_NAMES.NEWS_COLLECTION_POI, {
    teamSize: 5, // Process 5 POIs concurrently
    teamConcurrency: 1
  }, async (job) => {
    try {
      await handler(job.data);
    } catch (error) {
      console.error(`News collection failed for POI ${job.data.poiId}:`, error);
      throw error;
    }
  });
}

/**
 * Manually trigger news collection (for admin use)
 */
export async function triggerNewsCollection() {
  const scheduler = getJobScheduler();

  const jobId = await scheduler.send(JOB_NAMES.NEWS_COLLECTION, {
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  });

  console.log('Manual news collection triggered, job ID:', jobId);
  return jobId;
}

/**
 * Queue news collection for a specific POI
 * @param {number} poiId - POI ID
 * @param {string} poiName - POI name for logging
 */
export async function queuePoiNewsCollection(poiId, poiName) {
  const scheduler = getJobScheduler();

  return scheduler.send(JOB_NAMES.NEWS_COLLECTION_POI, {
    poiId,
    poiName,
    queuedAt: new Date().toISOString()
  });
}

/**
 * Get job status
 * @param {string} jobId - Job ID to check
 */
export async function getJobStatus(jobId) {
  const scheduler = getJobScheduler();
  return scheduler.getJobById(jobId);
}

/**
 * Register handler for admin-triggered batch news collection
 * @param {Function} handler - Async function to handle batch collection
 */
export async function registerBatchNewsHandler(handler) {
  const scheduler = getJobScheduler();

  // Create the queue if it doesn't exist
  try {
    await scheduler.createQueue(JOB_NAMES.NEWS_BATCH);
    console.log(`Queue '${JOB_NAMES.NEWS_BATCH}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.NEWS_BATCH}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWS_BATCH, {
    newJobCheckIntervalSeconds: 1  // Check for new jobs every second for responsive UI
  }, async (jobs) => {
    // pg-boss v10+ passes an array of jobs
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      console.log(`[pg-boss] Starting batch news collection job: ${job.id}`);
      try {
        await handler(job.id, job.data);
        console.log(`[pg-boss] Batch news collection job completed: ${job.id}`);
      } catch (error) {
        console.error(`[pg-boss] Batch news collection job failed:`, error);
        throw error; // Re-throw to mark job as failed in pg-boss
      }
    }
  });
}

/**
 * Submit a batch news collection job
 * @param {Object} options - Job options
 * @param {number[]} options.poiIds - Optional array of POI IDs (null = all POIs)
 * @param {boolean} options.triggeredManually - Whether this was manually triggered
 * @returns {string} - pg-boss job ID
 */
export async function submitBatchNewsJob(options = {}) {
  const scheduler = getJobScheduler();

  const pgBossJobId = await scheduler.send(JOB_NAMES.NEWS_BATCH, {
    jobId: options.jobId,    // news_job_status record ID
    poiIds: options.poiIds || null,
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  }, {
    retryLimit: 2,           // Retry failed jobs up to 2 times
    retryDelay: 30,          // Wait 30 seconds before retry
    expireInMinutes: 60      // Job expires after 60 minutes
  });

  console.log(`[pg-boss] Batch news collection job submitted: ${pgBossJobId}`);
  return pgBossJobId;
}

/**
 * Get the status of a batch news job from pg-boss
 * @param {string} jobId - pg-boss job ID
 */
export async function getBatchJobStatus(jobId) {
  const scheduler = getJobScheduler();
  return scheduler.getJobById(jobId);
}

/**
 * Schedule the trail status collection job
 * @param {string} cronExpression - Cron expression (default: every 30 minutes)
 */
export async function scheduleTrailStatusCollection(cronExpression = '*/30 * * * *') {
  const scheduler = getJobScheduler();

  // Create a schedule for the trail status collection job
  await scheduler.schedule(JOB_NAMES.TRAIL_STATUS_COLLECTION, cronExpression, {}, {
    tz: 'America/New_York'
  });

  console.log(`Trail status collection scheduled with cron: ${cronExpression}`);
}

/**
 * Register the trail status collection job handler
 * @param {Function} handler - Async function to handle the job
 */
export async function registerTrailStatusHandler(handler) {
  const scheduler = getJobScheduler();

  // Create the queue if it doesn't exist
  try {
    await scheduler.createQueue(JOB_NAMES.TRAIL_STATUS_COLLECTION);
    console.log(`Queue '${JOB_NAMES.TRAIL_STATUS_COLLECTION}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.TRAIL_STATUS_COLLECTION}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.TRAIL_STATUS_COLLECTION, async (job) => {
    console.log('Starting trail status collection job:', job.id);
    try {
      await handler(job.data);
      console.log('Trail status collection job completed:', job.id);
    } catch (error) {
      console.error('Trail status collection job failed:', error);
      throw error; // Re-throw to mark job as failed
    }
  });
}

/**
 * Register handler for batch trail status collection
 * @param {Function} handler - Async function to handle batch collection
 */
export async function registerBatchTrailStatusHandler(handler) {
  const scheduler = getJobScheduler();

  // Create the queue if it doesn't exist
  try {
    await scheduler.createQueue(JOB_NAMES.TRAIL_STATUS_BATCH);
    console.log(`Queue '${JOB_NAMES.TRAIL_STATUS_BATCH}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.TRAIL_STATUS_BATCH}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.TRAIL_STATUS_BATCH, {
    newJobCheckIntervalSeconds: 1  // Check for new jobs every second for responsive UI
  }, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      console.log(`[pg-boss] Starting batch trail status collection job: ${job.id}`);
      try {
        await handler(job.data.jobId, job.data.poiIds);
        console.log(`[pg-boss] Batch trail status collection job completed: ${job.id}`);
      } catch (error) {
        console.error(`[pg-boss] Batch trail status collection job failed:`, error);
        throw error; // Re-throw to mark job as failed in pg-boss
      }
    }
  });
}

/**
 * Register handler for content moderation (individual items)
 * @param {Function} handler - Async function(contentType, contentId) to moderate a single item
 */
export async function registerModerationHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.CONTENT_MODERATION);
    console.log(`Queue '${JOB_NAMES.CONTENT_MODERATION}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.CONTENT_MODERATION}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.CONTENT_MODERATION, {
    teamSize: 3,
    teamConcurrency: 1
  }, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      try {
        await handler(job.data.contentType, job.data.contentId);
      } catch (error) {
        console.error(`[pg-boss] Moderation failed for ${job.data.contentType} #${job.data.contentId}:`, error.message);
        throw error;
      }
    }
  });
}

/**
 * Queue a content moderation job for a single item
 * @param {string} contentType - 'news', 'event', or 'photo'
 * @param {number} contentId - ID of the content to moderate
 */
export async function queueModerationJob(contentType, contentId) {
  const scheduler = getJobScheduler();

  return scheduler.send(JOB_NAMES.CONTENT_MODERATION, {
    contentType,
    contentId,
    queuedAt: new Date().toISOString()
  }, {
    retryLimit: 2,
    retryDelay: 30,
    expireInMinutes: 15
  });
}

/**
 * Schedule the moderation sweep job (every 15 minutes)
 * @param {string} cronExpression - Cron expression
 */
export async function scheduleModerationSweep(cronExpression = '*/15 * * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.CONTENT_MODERATION_SWEEP, cronExpression, {}, {
    tz: 'America/New_York'
  });

  console.log(`Moderation sweep scheduled with cron: ${cronExpression}`);
}

/**
 * Register handler for moderation sweep
 * @param {Function} handler - Async function() to process all pending items
 */
export async function registerModerationSweepHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.CONTENT_MODERATION_SWEEP);
    console.log(`Queue '${JOB_NAMES.CONTENT_MODERATION_SWEEP}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.CONTENT_MODERATION_SWEEP}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.CONTENT_MODERATION_SWEEP, async (job) => {
    console.log('Starting moderation sweep job:', job.id);
    try {
      await handler();
      console.log('Moderation sweep job completed:', job.id);
    } catch (error) {
      console.error('Moderation sweep job failed:', error);
      throw error;
    }
  });
}

/**
 * Register handler for newsletter email processing
 * @param {Function} handler - async (emailId) => void
 */
export async function registerNewsletterHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.NEWSLETTER_PROCESS);
    console.log(`Queue '${JOB_NAMES.NEWSLETTER_PROCESS}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.NEWSLETTER_PROCESS}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWSLETTER_PROCESS, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      try {
        await handler(job.data.emailId);
      } catch (error) {
        console.error(`[pg-boss] Newsletter processing failed for email #${job.data.emailId}:`, error.message);
        throw error;
      }
    }
  });
}

/**
 * Queue a newsletter email for background processing
 * @param {number} emailId - ID of the newsletter_emails row to process
 */
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

/**
 * Schedule the nightly image backup job
 * @param {string} cronExpression - Cron expression (default: 2 AM Eastern daily)
 */
export async function scheduleImageBackup(cronExpression = '0 2 * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.IMAGE_BACKUP, cronExpression, {}, {
    tz: 'America/New_York'
  });

  console.log(`Image backup scheduled with cron: ${cronExpression}`);
}

/**
 * Register the image backup job handler
 * @param {Function} handler - Async function to handle the job
 */
export async function registerImageBackupHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.IMAGE_BACKUP);
    console.log(`Queue '${JOB_NAMES.IMAGE_BACKUP}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.IMAGE_BACKUP}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.IMAGE_BACKUP, async (job) => {
    console.log('Starting image backup job:', job.id);
    try {
      await handler(job.data);
      console.log('Image backup job completed:', job.id);
    } catch (error) {
      console.error('Image backup job failed:', error);
      throw error;
    }
  });
}

/**
 * Manually submit an image backup job
 * @returns {string} - pg-boss job ID
 */
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

  console.log(`[pg-boss] Image backup job submitted: ${jobId}`);
  return jobId;
}

/**
 * Schedule the nightly database backup job
 * @param {string} cronExpression - Cron expression (default: 3 AM Eastern daily)
 */
export async function scheduleDatabaseBackup(cronExpression = '0 3 * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.DATABASE_BACKUP, cronExpression, {}, {
    tz: 'America/New_York'
  });

  console.log(`Database backup scheduled with cron: ${cronExpression}`);
}

/**
 * Register the database backup job handler
 * @param {Function} handler - Async function to handle the job
 */
export async function registerDatabaseBackupHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.DATABASE_BACKUP);
    console.log(`Queue '${JOB_NAMES.DATABASE_BACKUP}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.DATABASE_BACKUP}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.DATABASE_BACKUP, async (job) => {
    console.log('Starting database backup job:', job.id);
    try {
      await handler(job.data);
      console.log('Database backup job completed:', job.id);
    } catch (error) {
      console.error('Database backup job failed:', error);
      throw error;
    }
  });
}

/**
 * Update the cron schedule for any job type (live update via pg-boss)
 * @param {string} jobName - pg-boss job name
 * @param {string} cronExpression - New cron expression
 */
export async function updateSchedule(jobName, cronExpression) {
  const scheduler = getJobScheduler();
  await scheduler.schedule(jobName, cronExpression, {}, { tz: 'America/New_York' });
  console.log(`Schedule updated: ${jobName} → ${cronExpression}`);
}

/**
 * Stop the job scheduler gracefully
 */
export async function stopJobScheduler() {
  if (boss) {
    await boss.stop();
    boss = null;
    console.log('Job scheduler stopped');
  }
}

export { JOB_NAMES };
