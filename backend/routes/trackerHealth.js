import express from 'express';

/**
 * Live tracker health (spec 055), mounted at /api/health/trackers.
 *
 *   GET /             both trackers' state and verdict, for people. Always 200.
 *   GET /train        one verdict, for Nagios: 200 when ok, 503 when broken.
 *   GET /water-taxi   same, for the water taxi.
 *
 * A parked train or an off-duty boat (night, off season) is ok, so Nagios
 * checks the per-tracker routes around the clock with no timetable.
 *
 * @param {{train: {status: Function, verdict: Function}, waterTaxi: {status: Function, verdict: Function}}} trackers
 *   The service functions, injected so tests can drive any verdict.
 * @returns {import('express').Router} The router for /api/health/trackers.
 */
export function createTrackerHealthRouter({ train, waterTaxi }) {
  const router = express.Router();
  const sendVerdict = (res, verdict) => res.status(verdict.ok ? 200 : 503).json(verdict);

  router.get('/', (_req, res) => {
    res.json({
      train: { ...train.status(), verdict: train.verdict() },
      waterTaxi: { ...waterTaxi.status(), verdict: waterTaxi.verdict() },
    });
  });
  router.get('/train', (_req, res) => sendVerdict(res, train.verdict()));
  router.get('/water-taxi', (_req, res) => sendVerdict(res, waterTaxi.verdict()));

  return router;
}
