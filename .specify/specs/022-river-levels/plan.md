# Implementation Plan: River Levels for Kayakers

> **Spec ID:** 022-river-levels
> **Status:** Planning
> **Last Updated:** 2026-05-22
> **Estimated Effort:** M

## Summary

Add a USGS river-gauge collection pipeline modeled on the existing trail-status feature:
a `pg-boss`-scheduled job fetches gage height / discharge from the USGS Water Services API
and upserts readings into two new tables. The frontend renders gauge markers on the map
(tied to the Rivers layer) and a "River Levels" sidebar tab with a dependency-free SVG
chart. First release seeds the Cuyahoga River gauges.

---

## Architecture

### Data Flow

1. `pg-boss` fires `river-levels-collection` hourly (mirrors `trail-status-collection`).
2. `riverLevelsService.runRiverLevelsCollection(pool)` loads enabled `river_gauges`.
3. For each gauge: GET `waterservices.usgs.gov/nwis/iv` (params 00065 + 00060, `period=P7D`),
   parse JSON, backfill gauge metadata (name/lat/lon), upsert readings on
   `(gauge_id, reading_time)`. Per-gauge try/catch — one failure doesn't abort the batch.
4. Frontend reads `/api/river-gauges` for markers and `/api/pois/:id/river-gauges`
   + `/api/river-gauges/:id/readings` for the sidebar tab.

### Why model on trail-status

Trail-status is the closest existing pattern: scheduled `pg-boss` job, `admin_settings`
toggles, a registry entry, a public per-POI read endpoint, and a manual admin trigger.
River levels is *simpler* — no Playwright, no AI, no batch/resumability — so we reuse the
shape and drop the heavy parts.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Data source | USGS Water Services IV API (JSON) | Official, free, no API key, returns site metadata + time series |
| Scheduling | `pg-boss` via `jobScheduler.js` | Same mechanism as all other collection jobs |
| Job logging | `jobLogger.js` + `job_logs` (type `river_levels`) | No new job-status table needed (mirrors `moderation_sweep`) |
| HTTP | global `fetch` (Node 20) | No new dependency |
| Chart | Inline SVG line chart component | Honors "keep it simple, no over-engineering"; avoids a ~500 KB `recharts` dep. (Alternative: `recharts` if richer interactivity is wanted — flagged for plan approval.) |

---

## Implementation Steps

### Phase 1: Schema + seed

- [ ] `backend/migrations/061_add_river_gauges.sql` — `river_gauges`, `river_gauge_readings`,
      `admin_settings` keys, and a Cuyahoga seed (`UPDATE`/`INSERT` matching the
      `river`-role Cuyahoga POI by name). Idempotent.
- [ ] Mirror the `CREATE TABLE IF NOT EXISTS` guards in `server.js` startup (as trail-status
      does) so fresh DBs work before migrations run.

### Phase 2: Collection service

- [ ] `backend/services/riverLevelsService.js`:
  - `fetchUsgsReadings(siteId)` — call the IV API, return `{ name, lat, lon, readings[] }`.
  - `collectGauge(pool, gauge)` — fetch, backfill metadata, upsert readings.
  - `runRiverLevelsCollection(pool)` — loop enabled gauges with per-gauge error handling;
    log via `jobLogger`.
  - `getGaugesForPoi(pool, poiId)`, `getAllGaugesWithLatest(pool)`,
    `getGaugeReadings(pool, gaugeId, period)` read helpers.

### Phase 3: Scheduler + registry + routes

- [ ] `jobScheduler.js`: add `RIVER_LEVELS_COLLECTION` job name, `scheduleRiverLevelsCollection`,
      `registerRiverLevelsHandler`, `triggerRiverLevelsCollection`.
- [ ] `server.js` startup: register handler (`withJitter`) + schedule `0 * * * *`.
- [ ] `collection/registry.js`: add a `river_levels` COLLECTION_TYPE so it shows in the Jobs
      dashboard with a manual trigger.
- [ ] Routes: public `GET /api/river-gauges`, `GET /api/pois/:id/river-gauges`,
      `GET /api/river-gauges/:id/readings`; admin `POST /api/admin/river-levels/collect`.

### Phase 4: Frontend — sidebar tab

- [ ] `sidebar/RiverLevels.jsx` — fetch `/api/pois/:id/river-gauges`; one card per gauge
      with current values, reading time, USGS link, and `LevelChart`.
- [ ] `LevelChart.jsx` — inline SVG line chart of readings (gage height default, cfs toggle).
- [ ] `Sidebar.jsx` — add `'river_levels'` to `SIDEBAR_TAB_LABELS` and to `visibleTabs` when
      the POI has the `river` role and ≥1 gauge (fetch a count alongside `tab-counts`, or a
      light `has_gauges` check); render the tab content block.

### Phase 5: Frontend — map markers

- [ ] `Map.jsx` — fetch `/api/river-gauges`; render a labeled `divIcon` marker per gauge
      showing latest gage height; show/hide with the existing `showRivers` toggle; on click,
      select the parent river POI and open the River Levels tab.

### Phase 6: Tests + docs

- [ ] Unit test for the USGS JSON parser (fixture → readings) and the upsert idempotency.
- [ ] `docs/RIVER_LEVELS_ARCHITECTURE.md` (architecture doc, per constitution Documentation
      principle).

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/061_add_river_gauges.sql` | Tables, settings, Cuyahoga seed |
| `backend/services/riverLevelsService.js` | USGS fetch, parse, upsert, read helpers |
| `frontend/src/components/sidebar/RiverLevels.jsx` | River Levels tab content |
| `frontend/src/components/LevelChart.jsx` | SVG time-series chart |
| `docs/RIVER_LEVELS_ARCHITECTURE.md` | Architecture documentation |
| `backend/tests/riverLevels.test.js` | Parser + idempotency unit tests |

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/jobScheduler.js` | Add river-levels job name, schedule/register/trigger fns |
| `backend/server.js` | CREATE TABLE guards, route handlers, scheduler wiring |
| `backend/services/collection/registry.js` | Add `river_levels` COLLECTION_TYPE |
| `frontend/src/components/Sidebar.jsx` | Tab label + visibility + content block |
| `frontend/src/components/Map.jsx` | Gauge markers tied to Rivers layer |

---

## Database Migrations

```sql
-- Migration: 061_add_river_gauges
-- Description: USGS river gauge metadata + time-series readings, Cuyahoga seed
CREATE TABLE IF NOT EXISTS river_gauges (
  id SERIAL PRIMARY KEY,
  usgs_site_id VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(200),
  river_poi_id INTEGER REFERENCES pois(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS river_gauge_readings (
  id SERIAL PRIMARY KEY,
  gauge_id INTEGER NOT NULL REFERENCES river_gauges(id) ON DELETE CASCADE,
  reading_time TIMESTAMPTZ NOT NULL,
  gage_height_ft NUMERIC,
  discharge_cfs NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (gauge_id, reading_time)
);
CREATE INDEX IF NOT EXISTS idx_river_gauge_readings_gauge_time
  ON river_gauge_readings(gauge_id, reading_time DESC);
-- admin settings (idempotent), Cuyahoga gauge seed associated by river POI name
```

---

## API Implementation

### Endpoint: `GET /api/river-gauges`

**Response:**
```json
[
  { "id": 1, "usgs_site_id": "04206000", "name": "Cuyahoga River at Old Portage OH",
    "latitude": 41.1356, "longitude": -81.5471, "river_poi_id": 42,
    "latest": { "reading_time": "2026-05-22T18:00:00Z", "gage_height_ft": 3.2, "discharge_cfs": 412 } }
]
```

### Endpoint: `GET /api/river-gauges/:id/readings?period=P7D`

**Response:**
```json
{ "gauge_id": 1, "readings": [ { "reading_time": "...", "gage_height_ft": 3.1, "discharge_cfs": 400 } ] }
```

---

## Testing Strategy

### Unit Tests

- [ ] `backend/tests/riverLevels.test.js` — parse a saved USGS JSON fixture into readings;
      assert upsert is idempotent (insert twice → one row per `reading_time`).

### Manual Testing

1. Start the feature container (`./run.sh start`, port 8082).
2. Trigger collection via the admin Jobs dashboard (or `POST /api/admin/river-levels/collect`).
3. Confirm Cuyahoga gauge markers appear with the Rivers layer on, showing a "x.x ft" label.
4. Open the Cuyahoga River POI → River Levels tab → confirm values + chart + USGS link.
5. Confirm the tab is absent for non-river POIs.

---

## Rollback Plan

1. Migration only adds tables/settings — drop `river_gauge_readings`, `river_gauges` and the
   `river_levels_*` settings to revert data.
2. Revert the PR; the scheduled job and routes disappear with the code. No other feature
   depends on these tables.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| USGS API downtime/format change | Med | Per-gauge try/catch; empty/"no data" UI states; parser unit test on a fixture |
| Cuyahoga POI name mismatch in seed | Low | Seed is idempotent `UPDATE ... WHERE name ILIKE` + `river` role; verify the POI exists during build/verify |
| Reading table growth | Low | Volume is tiny (~hundreds of rows/day); add pruning later if needed |
| Adding a chart dependency creep | Low | Use inline SVG; no new npm dependency |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-22 | Initial plan |
