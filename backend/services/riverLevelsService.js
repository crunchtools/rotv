/**
 * River Levels Service (#92)
 *
 * Collects official river gauge readings (gage height + discharge) from the USGS
 * Water Services Instantaneous Values API and stores them for kayakers. Modeled on
 * the trail-status collection feature but far simpler: no Playwright, no AI, no
 * resumable batch — just a polite scheduled fetch and an idempotent upsert.
 *
 * USGS IV API: https://waterservices.usgs.gov/nwis/iv/  (JSON, no API key required)
 */

import { logInfo, logError } from './jobLogger.js';

const USGS_IV_URL = 'https://waterservices.usgs.gov/nwis/iv/';
const USER_AGENT = 'RootsOfTheValley/1.0 (+https://rootsofthevalley.org; river levels for kayakers)';

// USGS parameter codes
const PARAM_DISCHARGE = '00060';   // ft3/s (cfs)
const PARAM_GAGE_HEIGHT = '00065'; // ft
const NO_DATA = -999999;           // USGS sentinel for missing values

/**
 * Parse a USGS IV JSON response into gauge metadata and a list of readings keyed by
 * timestamp. Pure (no I/O) and unit-tested in isolation — see riverLevels.unit.test.js.
 *
 * @param {object} json - parsed USGS IV response
 * @returns {{ name: string|null, latitude: number|null, longitude: number|null,
 *             readings: Array<{ reading_time: string, gage_height_ft: number|null, discharge_cfs: number|null }> }}
 */
export function parseUsgsResponse(json) {
  const series = json?.value?.timeSeries || [];
  let name = null;
  let latitude = null;
  let longitude = null;

  // Merge parameters that share a timestamp into a single reading.
  const byTime = new Map();

  for (const ts of series) {
    if (name === null) {
      name = ts?.sourceInfo?.siteName ?? null;
      const geo = ts?.sourceInfo?.geoLocation?.geogLocation;
      if (geo) {
        latitude = Number.isFinite(geo.latitude) ? geo.latitude : null;
        longitude = Number.isFinite(geo.longitude) ? geo.longitude : null;
      }
    }

    const paramCode = ts?.variable?.variableCode?.[0]?.value;
    if (paramCode !== PARAM_DISCHARGE && paramCode !== PARAM_GAGE_HEIGHT) continue;

    const values = ts?.values?.[0]?.value || [];
    for (const v of values) {
      const num = Number.parseFloat(v.value);
      if (!Number.isFinite(num) || num === NO_DATA) continue;
      const t = v.dateTime;
      if (!t) continue;

      const reading = byTime.get(t) || { reading_time: t, gage_height_ft: null, discharge_cfs: null };
      if (paramCode === PARAM_GAGE_HEIGHT) reading.gage_height_ft = num;
      else reading.discharge_cfs = num;
      byTime.set(t, reading);
    }
  }

  const readings = Array.from(byTime.values()).sort(
    (a, b) => new Date(a.reading_time) - new Date(b.reading_time)
  );

  return { name, latitude, longitude, readings };
}

/**
 * Run a full collection pass over all enabled gauges. For each gauge: fetch the last
 * 7 days from USGS, backfill its name + coordinates (the coordinates that place the map
 * marker), and upsert readings idempotently on (gauge_id, reading_time). Per-gauge
 * try/catch isolates failures so one bad gauge or a USGS hiccup never aborts the batch.
 */
export async function runRiverLevelsCollection(pool, options = {}) {
  const jobId = options.jobId || 0;

  const enabledSetting = await pool.query(
    `SELECT value FROM admin_settings WHERE key = 'river_levels_collection_enabled'`
  );
  if (enabledSetting.rows[0]?.value === 'false') {
    logInfo(jobId, 'river_levels', null, null, 'River levels collection is disabled — skipping');
    return { totalGauges: 0, gaugesProcessed: 0, readingsInserted: 0, disabled: true };
  }

  const { rows: gauges } = await pool.query(
    `SELECT id, usgs_site_id FROM river_gauges WHERE enabled = TRUE ORDER BY id`
  );

  let gaugesProcessed = 0;
  let readingsInserted = 0;

  for (const gauge of gauges) {
    try {
      const url = `${USGS_IV_URL}?format=json&sites=${encodeURIComponent(gauge.usgs_site_id)}` +
        `&parameterCd=${PARAM_DISCHARGE},${PARAM_GAGE_HEIGHT}&period=P7D`;

      // 30s guard so a hung USGS request can't stall the whole batch.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      let parsed;
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`USGS responded ${response.status} for site ${gauge.usgs_site_id}`);
        }
        parsed = parseUsgsResponse(await response.json());
      } finally {
        clearTimeout(timer);
      }

      // Backfill metadata from USGS (name + real-world coordinates for the map marker).
      await pool.query(
        `UPDATE river_gauges
            SET name = COALESCE($2, name),
                latitude = COALESCE($3, latitude),
                longitude = COALESCE($4, longitude),
                updated_at = NOW()
          WHERE id = $1`,
        [gauge.id, parsed.name, parsed.latitude, parsed.longitude]
      );

      let insertedForGauge = 0;
      for (const reading of parsed.readings) {
        const upsertRow = await pool.query(
          `INSERT INTO river_gauge_readings (gauge_id, reading_time, gage_height_ft, discharge_cfs)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (gauge_id, reading_time) DO UPDATE
             SET gage_height_ft = COALESCE(EXCLUDED.gage_height_ft, river_gauge_readings.gage_height_ft),
                 discharge_cfs   = COALESCE(EXCLUDED.discharge_cfs, river_gauge_readings.discharge_cfs)
           RETURNING (xmax = 0) AS is_insert`,
          [gauge.id, reading.reading_time, reading.gage_height_ft, reading.discharge_cfs]
        );
        if (upsertRow.rows[0]?.is_insert) insertedForGauge += 1;
      }

      gaugesProcessed += 1;
      readingsInserted += insertedForGauge;
      logInfo(jobId, 'river_levels', null, gauge.usgs_site_id,
        `River gauge ${gauge.usgs_site_id} (${parsed.name || 'unknown'}): ${parsed.readings.length} readings fetched, ${insertedForGauge} new`);
    } catch (error) {
      logError(jobId, 'river_levels', null, gauge.usgs_site_id,
        `River gauge ${gauge.usgs_site_id} collection failed: ${error.message}`);
    }
  }

  logInfo(jobId, 'river_levels', null, null,
    `River levels collection complete: ${gaugesProcessed}/${gauges.length} gauges, ${readingsInserted} new readings`);
  return { totalGauges: gauges.length, gaugesProcessed, readingsInserted };
}

/* ---------- Read helpers (serve the frontend) ---------- */

/**
 * All enabled gauges with their latest reading — powers the map markers.
 */
export async function getAllGaugesWithLatest(pool) {
  const { rows } = await pool.query(`
    SELECT g.id, g.usgs_site_id, g.name, g.river_poi_id, g.latitude, g.longitude,
           p.name AS river_name,
           r.reading_time, r.gage_height_ft, r.discharge_cfs
    FROM river_gauges g
    LEFT JOIN pois p ON p.id = g.river_poi_id
    LEFT JOIN LATERAL (
      SELECT reading_time, gage_height_ft, discharge_cfs
      FROM river_gauge_readings
      WHERE gauge_id = g.id
      ORDER BY reading_time DESC
      LIMIT 1
    ) r ON TRUE
    WHERE g.enabled = TRUE
      AND g.latitude IS NOT NULL AND g.longitude IS NOT NULL
    ORDER BY g.usgs_site_id
  `);
  return rows.map(formatGaugeWithLatest);
}

/**
 * Gauges associated with a given river POI, each with its latest reading.
 */
export async function getGaugesForPoi(pool, poiId) {
  const { rows } = await pool.query(`
    SELECT g.id, g.usgs_site_id, g.name, g.river_poi_id, g.latitude, g.longitude,
           r.reading_time, r.gage_height_ft, r.discharge_cfs
    FROM river_gauges g
    LEFT JOIN LATERAL (
      SELECT reading_time, gage_height_ft, discharge_cfs
      FROM river_gauge_readings
      WHERE gauge_id = g.id
      ORDER BY reading_time DESC
      LIMIT 1
    ) r ON TRUE
    WHERE g.river_poi_id = $1 AND g.enabled = TRUE
    ORDER BY g.usgs_site_id
  `, [poiId]);
  return rows.map(formatGaugeWithLatest);
}

/**
 * Time-series readings for a gauge within a window (days).
 */
export async function getGaugeReadings(pool, gaugeId, days = 7) {
  const safeDays = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);
  const { rows } = await pool.query(`
    SELECT reading_time, gage_height_ft, discharge_cfs
    FROM river_gauge_readings
    WHERE gauge_id = $1 AND reading_time >= NOW() - ($2 || ' days')::interval
    ORDER BY reading_time ASC
  `, [gaugeId, safeDays]);
  return rows.map(row => ({
    reading_time: row.reading_time,
    gage_height_ft: row.gage_height_ft != null ? Number(row.gage_height_ft) : null,
    discharge_cfs: row.discharge_cfs != null ? Number(row.discharge_cfs) : null
  }));
}

function formatGaugeWithLatest(row) {
  return {
    id: row.id,
    usgs_site_id: row.usgs_site_id,
    name: row.name,
    river_poi_id: row.river_poi_id,
    river_name: row.river_name ?? null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    usgs_url: `https://waterdata.usgs.gov/monitoring-location/USGS-${row.usgs_site_id}/`,
    latest: row.reading_time
      ? {
        reading_time: row.reading_time,
        gage_height_ft: row.gage_height_ft != null ? Number(row.gage_height_ft) : null,
        discharge_cfs: row.discharge_cfs != null ? Number(row.discharge_cfs) : null
      }
      : null
  };
}
