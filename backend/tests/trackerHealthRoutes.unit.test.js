/**
 * Tracker health routes (spec 055): the per-tracker routes Nagios checks map a
 * verdict to 200/503; the summary route stays 200 whatever the verdicts say.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTrackerHealthRouter } from '../routes/trackerHealth.js';

const OK = { ok: true, state: 'parked' };
const BROKEN = { ok: false, state: 'silent', reason: 'ignition on but last GPS fix is 20 min old' };

function appWith(trainVerdict, waterTaxiVerdict) {
  const app = express();
  app.use('/api/health/trackers', createTrackerHealthRouter({
    train: { status: () => ({ running: true }), verdict: () => trainVerdict },
    waterTaxi: { status: () => ({ connected: true }), verdict: () => waterTaxiVerdict },
  }));
  return app;
}

describe('tracker health routes', () => {
  it('returns 200 with the verdict when a tracker is ok', async () => {
    const app = appWith(OK, { ok: true, state: 'off_duty' });
    const train = await request(app).get('/api/health/trackers/train');
    expect(train.status).toBe(200);
    expect(train.body).toEqual(OK);
    const boat = await request(app).get('/api/health/trackers/water-taxi');
    expect(boat.status).toBe(200);
    expect(boat.body).toEqual({ ok: true, state: 'off_duty' });
  });

  it('returns 503 with the reason when a tracker is broken', async () => {
    const app = appWith(BROKEN, BROKEN);
    for (const path of ['/api/health/trackers/train', '/api/health/trackers/water-taxi']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(503);
      expect(res.body).toEqual(BROKEN);
    }
  });

  it('keeps the summary at 200 and carries both verdicts', async () => {
    const res = await request(appWith(BROKEN, OK)).get('/api/health/trackers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      train: { running: true, verdict: BROKEN },
      waterTaxi: { connected: true, verdict: OK },
    });
  });
});
