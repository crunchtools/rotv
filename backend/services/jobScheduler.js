import { PgBoss } from 'pg-boss';

let boss = null;

const JOB_NAMES = {
  NEWS_COLLECTION: 'news-collection',
  NEWS_COLLECTION_DAILY: 'news-collection-daily',
  NEWS_COLLECTION_WEEKLY: 'news-collection-weekly',
  NEWS_COLLECTION_MONTHLY: 'news-collection-monthly',
  NEWS_COLLECTION_POI: 'news-collection-poi',
  NEWS_BATCH: 'news-batch-collection',
  TRAIL_STATUS_COLLECTION: 'trail-status-collection',
  TRAIL_STATUS_BATCH: 'trail-status-batch-collect',
  CONTENT_MODERATION: 'content-moderation',
  CONTENT_MODERATION_SWEEP: 'content-moderation-sweep',
  NEWSLETTER_PROCESS: 'newsletter-process',
  NEWSLETTER_DIGEST: 'newsletter-digest',
  IMAGE_BACKUP: 'image-backup',
  DATABASE_BACKUP: 'database-backup'
};

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

  console.log(`News collection scheduled with cron: ${cronExpression}`);
}

export async function scheduleTierNewsCollection(tier, cronExpression) {
  const jobName = JOB_NAMES[`NEWS_COLLECTION_${tier.toUpperCase()}`];
  if (!jobName) throw new Error(`Invalid tier: ${tier}`);
  const scheduler = getJobScheduler();
  await scheduler.schedule(jobName, cronExpression, { tier }, { tz: 'America/New_York' });
  console.log(`${tier} news collection scheduled with cron: ${cronExpression}`);
}

export async function registerTierNewsCollectionHandler(tier, handler) {
  const jobName = JOB_NAMES[`NEWS_COLLECTION_${tier.toUpperCase()}`];
  if (!jobName) throw new Error(`Invalid tier: ${tier}`);
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(jobName);
    console.log(`Queue '${jobName}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${jobName}' may already exist`);
    }
  }

  await scheduler.work(jobName, async (job) => {
    console.log(`Starting ${tier} news collection job:`, job.id);
    try {
      await handler(job.data);
      console.log(`${tier} news collection job completed:`, job.id);
    } catch (error) {
      console.error(`${tier} news collection job failed:`, error);
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
    console.log(`Queue '${JOB_NAMES.NEWS_COLLECTION}' created`);
  } catch (error) {
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
      console.error(`News collection failed for POI ${job.data.poiId}:`, error);
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

  console.log('Manual news collection triggered, job ID:', jobId);
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
    console.log(`Queue '${JOB_NAMES.NEWS_BATCH}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.NEWS_BATCH}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWS_BATCH, {
    newJobCheckIntervalSeconds: 1
  }, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      console.log(`[pg-boss] Starting batch news collection job: ${job.id}`);
      try {
        await handler(job.id, job.data);
        console.log(`[pg-boss] Batch news collection job completed: ${job.id}`);
      } catch (error) {
        console.error(`[pg-boss] Batch news collection job failed:`, error);
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

  console.log(`[pg-boss] Batch news collection job submitted: ${pgBossJobId}`);
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

  console.log(`Trail status collection scheduled with cron: ${cronExpression}`);
}

export async function registerTrailStatusHandler(handler) {
  const scheduler = getJobScheduler();

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
      throw error;
    }
  });
}

export async function registerBatchTrailStatusHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.TRAIL_STATUS_BATCH);
    console.log(`Queue '${JOB_NAMES.TRAIL_STATUS_BATCH}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.TRAIL_STATUS_BATCH}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.TRAIL_STATUS_BATCH, {
    newJobCheckIntervalSeconds: 1
  }, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      console.log(`[pg-boss] Starting batch trail status collection job: ${job.id}`);
      try {
        await handler(job.data.jobId, job.data.poiIds);
        console.log(`[pg-boss] Batch trail status collection job completed: ${job.id}`);
      } catch (error) {
        console.error(`[pg-boss] Batch trail status collection job failed:`, error);
        throw error;
      }
    }
  });
}

export async function scheduleModerationSweep(cronExpression = '0 7 * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.CONTENT_MODERATION_SWEEP, cronExpression, {}, {
    tz: 'America/New_York'
  });

  console.log(`Moderation sweep scheduled with cron: ${cronExpression}`);
}

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

  console.log(`Image backup scheduled with cron: ${cronExpression}`);
}

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

export async function scheduleDatabaseBackup(cronExpression = '0 3 * * *') {
  const scheduler = getJobScheduler();

  await scheduler.schedule(JOB_NAMES.DATABASE_BACKUP, cronExpression, {}, {
    tz: 'America/New_York'
  });

  console.log(`Database backup scheduled with cron: ${cronExpression}`);
}

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

export async function updateSchedule(jobName, cronExpression) {
  const scheduler = getJobScheduler();
  await scheduler.schedule(jobName, cronExpression, {}, { tz: 'America/New_York' });
  console.log(`Schedule updated: ${jobName} → ${cronExpression}`);
}

export async function registerDigestHandler(handler) {
  const scheduler = getJobScheduler();

  try {
    await scheduler.createQueue(JOB_NAMES.NEWSLETTER_DIGEST);
    console.log(`Queue '${JOB_NAMES.NEWSLETTER_DIGEST}' created`);
  } catch (error) {
    if (!error.message?.includes('already exists')) {
      console.log(`Queue '${JOB_NAMES.NEWSLETTER_DIGEST}' may already exist`);
    }
  }

  await scheduler.work(JOB_NAMES.NEWSLETTER_DIGEST, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of jobList) {
      console.log('Starting newsletter digest job:', job.id);
      try {
        await handler(job.id, job.data);
        console.log('Newsletter digest sent successfully:', job.id);
      } catch (error) {
        console.error('Newsletter digest job failed:', error);
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

  console.log(`Newsletter digest scheduled with cron: ${cronExpression}`);
}

export async function triggerDigestManually() {
  const scheduler = getJobScheduler();

  const jobId = await scheduler.send(JOB_NAMES.NEWSLETTER_DIGEST, {
    triggeredManually: true,
    triggeredAt: new Date().toISOString()
  });

  console.log('Manual digest send triggered, job ID:', jobId);
  return jobId;
}

export async function stopJobScheduler() {
  if (boss) {
    await boss.stop();
    boss = null;
    console.log('Job scheduler stopped');
  }
}

export function withJitter(handler, jobName, minSeconds = 1, maxSeconds = 60) {
  return async (...args) => {
    const delay = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
    console.log(`[Jitter] ${jobName} delayed by ${delay}s`);
    await new Promise(resolve => setTimeout(resolve, delay * 1000));
    return handler(...args);
  };
}

export { JOB_NAMES };
