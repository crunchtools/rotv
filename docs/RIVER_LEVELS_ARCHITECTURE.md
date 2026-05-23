# River Levels Architecture (#92)

## Introduction: How It Works

Kayakers and paddlers judge whether a river is runnable by its **discharge** (flow rate,
in cubic feet per second) and **gage height** (depth, in feet). This data is published by
the U.S. Geological Survey but scattered across hard-to-read government pages. The River
Levels feature pulls official USGS gauge readings on a schedule, stores them in
PostgreSQL, and surfaces them in two places:

1. **Map markers** — each gauge appears at its real-world location with its current flow.
2. **River Levels sidebar tab** — a per-river panel with current values and a 7-day chart.

The first release covers the Cuyahoga River.

## Data Source

USGS Water Services **Instantaneous Values** API — no API key required:

```
https://waterservices.usgs.gov/nwis/iv/?format=json&sites=04206000&parameterCd=00060,00065&period=P7D
```

- `00060` — discharge (ft³/s, "cfs")
- `00065` — gage height (ft)
- `-999999` is the USGS no-data sentinel and is dropped during parsing.

The response includes site metadata (`siteName`, `geoLocation`) which we use to backfill
each gauge's name and coordinates — so **the map marker position comes straight from USGS**,
not from manual entry.

## Why Gauges Are Not POIs

Gauges are lightweight external data points, not destinations. POIs carry heavy machinery
(roles, news/events collection, research, moderation, associations, hero images). Gauges
live in their own `river_gauges` table, are associated to the river POI they belong to,
and render as a distinct marker layer. This keeps gauges cheap and keeps the collection
pipelines from ever touching them.

## Data Model

| Table | Purpose |
|-------|---------|
| `river_gauges` | One row per USGS site: `usgs_site_id`, `name`, `river_poi_id`, `latitude`, `longitude`, `enabled` |
| `river_gauge_readings` | Time-series: `gauge_id`, `reading_time`, `gage_height_ft`, `discharge_cfs`; `UNIQUE (gauge_id, reading_time)` |

Migration: `backend/migrations/061_add_river_gauges.sql` (idempotent; seeds Cuyahoga gauges
`04206000` Old Portage and `04208000` Independence, and links them to the "Cuyahoga River"
river-role POI). The same `CREATE TABLE IF NOT EXISTS` guards exist in `server.js` startup
so fresh and test databases have the schema.

## Collection Pipeline

`backend/services/riverLevelsService.js`:

```
runRiverLevelsCollection(pool)
  └─ for each enabled gauge (per-gauge try/catch — one failure never aborts the batch):
       fetchUsgsReadings(siteId)  →  parseUsgsResponse(json)
       backfill name + lat/lon
       upsertReadings()  (ON CONFLICT (gauge_id, reading_time) — idempotent)
```

Scheduled hourly via `pg-boss` (`river-levels-collection`), wired in `server.js` startup
exactly like trail-status. Logs to `job_logs` under type `river_levels` (no dedicated
job-status table). Registered in `collection/registry.js` so it appears in the admin Jobs
dashboard with a manual trigger (`POST /api/admin/river-levels/collect`).

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/river-gauges` | All enabled gauges + latest reading (map markers) |
| GET | `/api/pois/:id/river-gauges` | Gauges for a river POI + latest reading (sidebar tab) |
| GET | `/api/river-gauges/:id/readings?days=7` | Time-series for the chart |
| POST | `/api/admin/river-levels/collect` | Manual collection trigger (admin) |

## Frontend

- `Map.jsx` — fetches `/api/river-gauges`, renders labeled gauge markers (current cfs) tied
  to the existing **Rivers** layer toggle. Clicking a marker navigates to
  `/<river-slug>/river_levels`, reusing the permalink routing to open the tab.
- `Sidebar.jsx` — adds a **River Levels** tab, shown only for `river`-role POIs that have
  ≥1 associated gauge (checked via `/api/pois/:id/river-gauges`).
- `sidebar/RiverLevels.jsx` — one card per gauge: current discharge + gage height + reading
  age, a metric toggle, the chart, and a link to the USGS monitoring-location page.
- `LevelChart.jsx` — `recharts` line chart; discharge (cfs) is the default series.

## Seeded Water Bodies (first release)

| River POI | Gauges | Geometry source |
|-----------|--------|-----------------|
| Cuyahoga River | 6 (Hiram Rapids, Old Portage, Jaite, Independence, Lower Harvard Bridge, Rivergate) | pre-existing POI |
| Tinkers Creek | 1 (at Bedford) | OSM → `backend/data/rivers/` |
| Brandywine Creek | 1 (near Macedonia) | OSM |
| Chippewa Creek | 1 (Chippewa Met Pk) | OSM |
| Indian Creek | 1 (near Macedonia) | OSM |
| Tuscarawas River (Portage Lakes outflow) | 2 (above Barberton, at Clinton) | OSM |

The tributary/Tuscarawas **river POIs** are created by migration `061` (name + `river`
role + description); their **MultiLineString geometry** is loaded separately from
version-controlled OpenStreetMap-derived GeoJSON in `backend/data/rivers/*.geojson` by:

```
node /app/migrations/load-river-geometry.js
```

This mirrors the county/state boundary loader pattern. **Deploy order:** migrations run
automatically (creating POIs + gauges + associations), then run the geometry loader once,
then restart so the new rivers render. Re-running the loader is a no-op once geometry is set.

## Adding More Rivers

1. Drop a `MultiLineString` GeoJSON into `backend/data/rivers/<slug>.geojson` and register it
   in `load-river-geometry.js` (or attach to an existing `river`-role POI).
2. Add the POI row (`river` role) and the gauge rows + association to the migration.
3. The next collection run backfills each gauge's name + coordinates from USGS.

No application-code changes are required to add gauges or rivers.
