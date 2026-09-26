import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fake pg-boss: records queue creation, schedules, sends, and captures the work()
// callback so tests can deliver jobs to it the way pg-boss would.
vi.mock('pg-boss', () => ({
  PgBoss: class {
    constructor() {
      this.createQueue = vi.fn().mockResolvedValue(undefined);
      this.work = vi.fn(async (name, options, callback) => {
        this.workers[name] = { options, callback };
        return `worker-${name}`;
      });
      this.workers = {};
      this.schedule = vi.fn().mockResolvedValue(undefined);
      this.send = vi.fn().mockResolvedValue('pgboss-job-1');
      this.on = vi.fn();
      this.start = vi.fn().mockResolvedValue(undefined);
      this.stop = vi.fn().mockResolvedValue(undefined);
    }
  }
}));

const {
  initJobScheduler, stopJobScheduler, JOB_NAMES,
  registerNewsCollectionHandler, registerBatchNewsHandler, registerBatchTrailStatusHandler,
  registerNewsletterHandler, registerModerationSweepHandler, registerDigestHandler,
  registerPipelineCollectionHandler, submitBatchNewsJob, triggerDigestManually,
  triggerPreviewManually, scheduleNewsCollection, schedulePipelineCollection, scheduleImageBackup
} = await import('../services/jobScheduler.js');

let infoSpy;
let warnSpy;
let errorSpy;
let boss;

const logLines = spy => spy.mock.calls.map(args => args[0]);

beforeEach(async () => {
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  boss = await initJobScheduler('postgres://test');
});

afterEach(async () => {
  await stopJobScheduler();
  vi.restoreAllMocks();
});

describe('registerWorker (via register*Handler exports)', () => {
  it('creates the queue before attaching the worker', async () => {
    const order = [];
    boss.createQueue.mockImplementation(async name => { order.push(`create:${name}`); });
    const originalWork = boss.work;
    boss.work = vi.fn(async (...args) => { order.push(`work:${args[0]}`); return originalWork(...args); });

    await registerNewsCollectionHandler(vi.fn());

    expect(order).toEqual([`create:${JOB_NAMES.NEWS_COLLECTION}`, `work:${JOB_NAMES.NEWS_COLLECTION}`]);
  });

  it('still registers the worker when createQueue fails, logging a warning', async () => {
    boss.createQueue.mockRejectedValue(new Error('permission denied'));

    await registerNewsCollectionHandler(vi.fn());

    expect(boss.workers[JOB_NAMES.NEWS_COLLECTION]).toBeDefined();
    expect(logLines(warnSpy)).toContain(
      `[JobScheduler] Queue '${JOB_NAMES.NEWS_COLLECTION}' could not be created, assuming it exists: permission denied`
    );
  });

  it('handles a single job object and passes job.data to the handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await registerNewsCollectionHandler(handler);

    await boss.workers[JOB_NAMES.NEWS_COLLECTION].callback({ id: 'j1', data: { poiId: 7 } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ poiId: 7 });
  });

  it('handles a batch array, running each job in order', async () => {
    const seen = [];
    await registerNewsCollectionHandler(async data => { seen.push(data.n); });

    await boss.workers[JOB_NAMES.NEWS_COLLECTION].callback([
      { id: 'a', data: { n: 1 } },
      { id: 'b', data: { n: 2 } },
      { id: 'c', data: { n: 3 } }
    ]);

    expect(seen).toEqual([1, 2, 3]);
  });

  it('logs start and completion for each job', async () => {
    await registerNewsCollectionHandler(vi.fn().mockResolvedValue(undefined));

    await boss.workers[JOB_NAMES.NEWS_COLLECTION].callback({ id: 'j9', data: {} });

    expect(logLines(infoSpy)).toEqual(expect.arrayContaining([
      '[JobScheduler] Starting news collection job: j9',
      '[JobScheduler] news collection job completed: j9'
    ]));
  });

  it('rethrows handler failures so pg-boss retries, and stops the batch there', async () => {
    const failure = new Error('crawl exploded');
    const handler = vi.fn(async data => { if (data.n === 2) throw failure; });
    await registerNewsCollectionHandler(handler);

    const delivery = boss.workers[JOB_NAMES.NEWS_COLLECTION].callback([
      { id: 'a', data: { n: 1 } },
      { id: 'b', data: { n: 2 } },
      { id: 'c', data: { n: 3 } }
    ]);

    await expect(delivery).rejects.toBe(failure);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith('[JobScheduler] news collection job failed (b):', failure);
    expect(logLines(infoSpy)).not.toContain('[JobScheduler] news collection job completed: b');
  });

  it('passes workOptions through and uses the pg-boss logger for batch news', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await registerBatchNewsHandler(handler);

    const worker = boss.workers[JOB_NAMES.NEWS_BATCH];
    expect(worker.options).toEqual({ newJobCheckIntervalSeconds: 1 });

    await worker.callback({ id: 'b1', data: { jobId: 42 } });
    expect(handler).toHaveBeenCalledWith('b1', { jobId: 42 });
    expect(logLines(infoSpy)).toContain('[pg-boss] Starting batch news collection job: b1');
  });

  it('defaults workOptions to an empty object', async () => {
    await registerNewsCollectionHandler(vi.fn());
    expect(boss.workers[JOB_NAMES.NEWS_COLLECTION].options).toEqual({});
  });

  it('maps job fields to handler arguments per registration', async () => {
    const trail = vi.fn().mockResolvedValue(undefined);
    const newsletter = vi.fn().mockResolvedValue(undefined);
    const sweep = vi.fn().mockResolvedValue(undefined);
    const digest = vi.fn().mockResolvedValue(undefined);
    await registerBatchTrailStatusHandler(trail);
    await registerNewsletterHandler(newsletter);
    await registerModerationSweepHandler(sweep);
    await registerDigestHandler(digest);

    await boss.workers[JOB_NAMES.TRAIL_STATUS_BATCH].callback({ id: 't', data: { jobId: 5, poiIds: [1, 2] } });
    await boss.workers[JOB_NAMES.NEWSLETTER_PROCESS].callback({ id: 'n', data: { emailId: 'em-1' } });
    await boss.workers[JOB_NAMES.CONTENT_MODERATION_SWEEP].callback({ id: 's', data: { ignored: true } });
    await boss.workers[JOB_NAMES.NEWSLETTER_DIGEST].callback({ id: 'd', data: { x: 1 } });

    expect(trail).toHaveBeenCalledWith(5, [1, 2]);
    expect(newsletter).toHaveBeenCalledWith('em-1');
    expect(sweep).toHaveBeenCalledWith();
    expect(digest).toHaveBeenCalledWith('d', { x: 1 });
  });

  it('rejects unknown pipelines without touching pg-boss', async () => {
    await expect(registerPipelineCollectionHandler('bogus', vi.fn())).rejects.toThrow('Invalid pipeline: bogus');
    expect(boss.createQueue).not.toHaveBeenCalled();
    expect(boss.work).not.toHaveBeenCalled();
  });
});

describe('sendManualJob (via submit*/trigger* exports)', () => {
  it('stamps manual-trigger metadata and passes retry options for batch news', async () => {
    const id = await submitBatchNewsJob({ jobId: 11, poiIds: [3, 4] });

    expect(id).toBe('pgboss-job-1');
    const [name, payload, options] = boss.send.mock.calls[0];
    expect(name).toBe(JOB_NAMES.NEWS_BATCH);
    expect(payload).toMatchObject({ jobId: 11, poiIds: [3, 4], triggeredManually: true });
    expect(new Date(payload.triggeredAt).toISOString()).toBe(payload.triggeredAt);
    expect(options).toEqual({ retryLimit: 2, retryDelay: 30, expireInMinutes: 60 });
  });

  it('normalizes a missing poiIds to null', async () => {
    await submitBatchNewsJob({ jobId: 12 });
    expect(boss.send.mock.calls[0][1].poiIds).toBeNull();
  });

  it('sends digest and preview triggers with no send options', async () => {
    boss.send.mockResolvedValueOnce('digest-id').mockResolvedValueOnce('preview-id');

    await expect(triggerDigestManually()).resolves.toBe('digest-id');
    await expect(triggerPreviewManually()).resolves.toBe('preview-id');

    const [digestCall, previewCall] = boss.send.mock.calls;
    expect(digestCall[0]).toBe(JOB_NAMES.NEWSLETTER_DIGEST);
    expect(digestCall[1]).toMatchObject({ triggeredManually: true });
    expect(digestCall[2]).toBeUndefined();
    expect(previewCall[0]).toBe(JOB_NAMES.NEWSLETTER_PREVIEW);
  });

  it('propagates send failures to the caller', async () => {
    boss.send.mockRejectedValue(new Error('db down'));
    await expect(submitBatchNewsJob({ jobId: 1 })).rejects.toThrow('db down');
  });
});

describe('scheduleCron (via schedule* exports)', () => {
  it('schedules in America/New_York with the default cron and empty data', async () => {
    await scheduleNewsCollection();
    expect(boss.schedule).toHaveBeenCalledWith(
      JOB_NAMES.NEWS_COLLECTION, '0 6 * * *', {}, { tz: 'America/New_York' }
    );
    expect(logLines(infoSpy)).toContain('[JobScheduler] News collection scheduled with cron: 0 6 * * *');
  });

  it('passes a custom cron expression through', async () => {
    await scheduleImageBackup('15 4 * * *');
    expect(boss.schedule).toHaveBeenCalledWith(
      JOB_NAMES.IMAGE_BACKUP, '15 4 * * *', {}, { tz: 'America/New_York' }
    );
  });

  it('attaches the pipeline name as job data for pipeline schedules', async () => {
    await schedulePipelineCollection('historical_news', '0 5 * * 0');
    expect(boss.schedule).toHaveBeenCalledWith(
      JOB_NAMES.HISTORICAL_NEWS, '0 5 * * 0', { pipeline: 'historical_news' }, { tz: 'America/New_York' }
    );
  });

  it('does not log success when scheduling fails', async () => {
    boss.schedule.mockRejectedValue(new Error('bad cron'));
    await expect(scheduleNewsCollection('nope')).rejects.toThrow('bad cron');
    expect(logLines(infoSpy).some(line => line.includes('scheduled with cron'))).toBe(false);
  });
});

describe('scheduler lifecycle', () => {
  it('throws from exported helpers when the scheduler is not initialized', async () => {
    await stopJobScheduler();
    await expect(scheduleNewsCollection()).rejects.toThrow('Job scheduler not initialized');
    await expect(registerNewsCollectionHandler(vi.fn())).rejects.toThrow('Job scheduler not initialized');
  });
});
