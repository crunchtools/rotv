# Specification: River Levels for Kayakers

> **Spec ID:** 022-river-levels
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-22

## Overview

Kayakers and paddlers currently have to read fragmented, hard-to-interpret government
gauge websites (e.g. USGS) to judge whether a river is runnable. This feature pulls
official river gauge data (gage height and discharge) from the USGS Water Services API
on a schedule, stores it in PostgreSQL, and presents it in two places: as gauge markers
on the map showing the current water level at each point, and as a "River Levels" tab in
the sidebar for river POIs with a time-series chart. The first release covers the
Cuyahoga River.

Closes #92.

---

## User Stories

### Discovery on the Map

**US-001: See current water level at a glance**
> As a kayaker, I want to see each gauge point along a river on the map with its current
> water level, so that I can judge runnability without leaving ROTV.

Acceptance Criteria:
- [ ] Each enabled gauge renders as a distinct marker at its real lat/lon.
- [ ] The marker shows the latest gage height (e.g. "3.2 ft") as a label.
- [ ] Gauge markers appear/disappear with the existing "Rivers" map layer toggle.
- [ ] Clicking a gauge selects its parent river POI and opens the River Levels tab.

### River Detail

**US-002: View the level trend for a river**
> As a paddler, I want a "River Levels" tab on a river's panel showing a chart of recent
> gage height and discharge, so that I can see whether the river is rising or falling.

Acceptance Criteria:
- [ ] A "River Levels" tab appears only for POIs with the `river` role that have at least
      one associated gauge.
- [ ] Each gauge shows current gage height (ft) and discharge (cfs), the time of the
      reading, and a line chart of the last 7 days.
- [ ] Each gauge links out to its official USGS monitoring-location page.
- [ ] When no readings exist yet, the tab shows a clear "no data yet" state rather than
      an error.

### Data Collection

**US-003: Keep levels current automatically**
> As the site operator, I want gauge readings collected on a schedule so the displayed
> levels stay current without manual work.

Acceptance Criteria:
- [ ] A scheduled job fetches recent readings for all enabled gauges from USGS and stores
      them idempotently (re-running does not duplicate readings).
- [ ] The job can be triggered manually from the admin Jobs dashboard.
- [ ] A USGS outage or a single bad gauge fails gracefully (logged, other gauges still
      processed) and never crashes the scheduler.

---

## Data Model

### New Tables

| Table | Description |
|-------|-------------|
| `river_gauges` | One row per USGS monitoring location, associated to a river POI |
| `river_gauge_readings` | Time-series gage height / discharge readings per gauge |

### Schema Changes

```sql
CREATE TABLE IF NOT EXISTS river_gauges (
  id            SERIAL PRIMARY KEY,
  usgs_site_id  VARCHAR(20) NOT NULL UNIQUE,        -- e.g. '04206000'
  name          VARCHAR(200),                       -- from USGS siteName
  river_poi_id  INTEGER REFERENCES pois(id) ON DELETE SET NULL,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  enabled       BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS river_gauge_readings (
  id             SERIAL PRIMARY KEY,
  gauge_id       INTEGER NOT NULL REFERENCES river_gauges(id) ON DELETE CASCADE,
  reading_time   TIMESTAMPTZ NOT NULL,
  gage_height_ft NUMERIC,
  discharge_cfs  NUMERIC,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (gauge_id, reading_time)
);
```

Plus seed rows associating the Cuyahoga River gauge(s) to the Cuyahoga River POI, and
`admin_settings` keys for enable/interval, all idempotent (`IF NOT EXISTS` / `ON CONFLICT
DO NOTHING`).

### Why a dedicated table instead of making gauges POIs

Gauges are lightweight external data points, not destinations. POIs carry heavy machinery
(roles, news/events collection, research, moderation, associations, hero images). Modeling
gauges as POIs would pollute the POI list and map and invite the collection pipelines to
process them. A dedicated `river_gauges` table keeps gauges cheap, renders them as a
distinct marker layer, and associates them to the river POI they belong to.

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/river-gauges` | All enabled gauges with coords + latest reading (for map markers) | No |
| GET | `/api/pois/:id/river-gauges` | Gauges for a river POI with latest reading | No |
| GET | `/api/river-gauges/:id/readings?period=P7D` | Time-series readings for a gauge | No |
| POST | `/api/admin/river-levels/collect` | Manually trigger collection | Admin |

---

## UI/UX Requirements

### New Components

- `sidebar/RiverLevels.jsx` — the "River Levels" tab: one card per gauge with current
  values, reading time, USGS link, and a chart.
- `LevelChart.jsx` (or equivalent) — a small time-series line chart of readings.
- Gauge markers in `Map.jsx` — labeled markers tied to the Rivers layer.

### Wireframes

```
River Levels tab (sidebar)
┌────────────────────────────────────────┐
│ Cuyahoga River at Old Portage           │
│ 3.2 ft   •   412 cfs   •   12 min ago   │
│ ┌────────────────────────────────────┐ │
│ │   gage height — last 7 days        │ │
│ │      ╱╲      ╱╲                     │ │
│ │  ╱╲ ╱  ╲___╱   ╲__                  │ │
│ └────────────────────────────────────┘ │
│ View on USGS ↗                          │
└────────────────────────────────────────┘

Map marker:  ◆ 3.2 ft
```

---

## Non-Functional Requirements

**NFR-001: Resilience**
- USGS API failures are caught per-gauge; one failure does not abort the batch.
- Frontend renders a "no data yet" empty state instead of erroring.

**NFR-002: Idempotency**
- Migration re-runs cleanly on every container start.
- Readings upsert on `(gauge_id, reading_time)` — no duplicates.

**NFR-003: Politeness**
- Collection runs hourly and requests a short window (`period=P7D`) per gauge. No API key
  required by USGS; identify with a descriptive User-Agent.

---

## Dependencies

- Depends on: existing `river`-role linear-feature POIs (Cuyahoga River already on the map).
- External: USGS Water Services Instantaneous Values API (`waterservices.usgs.gov/nwis/iv`).

---

## Open Questions

1. Charting: dependency-free inline SVG chart vs. adding `recharts`. (Plan recommends SVG
   to honor the "keep it simple, no over-engineering" principle.)
2. Should discharge (cfs) or gage height (ft) be the default charted series? (Plan: show
   both values numerically; chart gage height with a toggle to cfs.)
3. Reading retention — keep all (small volume) vs. prune older than N days. (Plan: keep
   all for v1; revisit if volume grows.)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-22 | Initial draft |
