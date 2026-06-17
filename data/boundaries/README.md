# Municipal Boundary Data

This directory contains GeoJSON boundary data for Akron and Cuyahoga Falls, Ohio.

## Files

- `akron.geojson` - Akron city boundary (1,605 coordinate points)
- `cuyahoga_falls.geojson` - Cuyahoga Falls city boundary (5 polygons, MultiPolygon)
- `insert_boundaries.sql` - SQL script to insert both boundaries into the database

## Data Source

- **Source:** OpenStreetMap via Nominatim API
- **License:** ODbL 1.0 (http://osm.org/copyright)
- **Retrieved:** February 4, 2026
- **OSM Relation IDs:**
  - Akron: 182644
  - Cuyahoga Falls: 182643

## Usage

### Local Development

```bash
./run.sh start
podman cp data/boundaries/insert_boundaries.sql rotv:/tmp/
podman exec rotv psql -U postgres -d rotv -f /tmp/insert_boundaries.sql
```

### Production Upload

See options below for uploading to production database.

## Database Structure

Boundaries are stored in the `pois` table with:
- `poi_type`: 'boundary'
- `geometry`: JSONB field containing GeoJSON Polygon or MultiPolygon
- `name`: Municipality name

## Total Boundaries

After adding Akron and Cuyahoga Falls, there are 11 municipal boundaries:
1. Akron (NEW)
2. Bedford
3. Brecksville
4. Cleveland
5. Cuyahoga Falls (NEW)
6. Cuyahoga Heights
7. Cuyahoga Valley National Park
8. Independence
9. Newburgh Heights
10. Valley View
11. Walton Hills

## Boundary Colors

Each municipality has a unique color for visual distinction on the map:

| Municipality | Color Code | Color Name |
|--------------|------------|------------|
| **Akron** | `#9370DB` | Medium Purple |
| Bedford | `#8B008B` | Dark Magenta |
| Brecksville | `#FF8C00` | Dark Orange |
| Cleveland | `#000080` | Navy |
| **Cuyahoga Falls** | `#20B2AA` | Light Sea Green |
| Cuyahoga Heights | `#8B4513` | Saddle Brown |
| Cuyahoga Valley National Park | `#228B22` | Forest Green |
| **Hudson** | `#B22222` | Firebrick |
| Independence | `#DC143C` | Crimson |
| Newburgh Heights | `#2F4F4F` | Dark Slate Gray |
| Valley View | `#4682B4` | Steel Blue |
| Walton Hills | `#8B4513` | Saddle Brown |

### Update Boundary Colors

To update the colors for Akron and Cuyahoga Falls:

```bash
podman exec rotv psql -U postgres -d rotv -f /tmp/update_colors.sql
```

Or on production:

```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com \
  "podman cp update_colors.sql rootsofthevalley.org:/tmp/ && \
   podman exec rootsofthevalley.org psql -U rotv rotv -f /tmp/update_colors.sql"
```


---

# Hudson Municipal Boundary

City boundary for **Hudson, Ohio** (Summit County). Added to fix a news-collection
problem: **Green Valley Brewing Co.** (POI 6372) sits in Hudson, but no Hudson
boundary existed, so `geoService.getContainingBoundaries()` fell back to the
`Summit County` boundary. `serperService` then built a county-wide news query
(`"...for Green Valley Brewing Co. in Summit County, Ohio"`) that vacuumed up
regional noise (parks, bridges, elections) instead of news about the brewery.
With the city boundary in place, the POI grounds to Hudson first (smallest
containing boundary), tightening the search.

## Files

- `hudson.geojson` — single-Polygon EPSG:4326 FeatureCollection (301 points)
- `insert_hudson.sql` — idempotent import (sets `boundary_geom` for grounding)

## Data Source

- **Source:** OpenStreetMap via Nominatim API — **License:** ODbL 1.0
- **Retrieved:** 2026-06-13 — **OSM Relation ID:** 181817

## Schema

Same current model as the metro/municipal park imports (NOT legacy `poi_type`):
`poi_roles=ARRAY['boundary']`, `boundary_type='municipal'` (Municipal panel),
`geometry` JSONB, and PostGIS `boundary_geom` — the column grounding reads.

## Local / Production Import

```bash
# Local
podman cp data/boundaries/insert_hudson.sql rotv:/tmp/
podman exec rotv psql -U postgres -d rotv -f /tmp/insert_hudson.sql
# Production (lotor)
scp -P 22422 data/boundaries/insert_hudson.sql root@lotor.dc3.crunchtools.com:/tmp/
ssh -p 22422 root@lotor.dc3.crunchtools.com \
  "podman cp /tmp/insert_hudson.sql rootsofthevalley.org:/tmp/ && \
   podman exec rootsofthevalley.org psql -U rotv rotv -f /tmp/insert_hudson.sql"
```

> **Companion fix (included in `insert_hudson.sql`):** Green Valley Brewing Co.
> was on `collection_tier='daily'` (migration 043 auto-assigns daily to any POI
> with a `news_url`/`events_url`; the brewery has a Facebook events URL). The
> import reclassifies it to weekly — keyed by name, since POI ids are not stable
> across environments.


---

# Summit Metro Parks Boundaries (Issue #198)

Individual park boundaries for the Summit Metro Parks system, used for
multi-level geographic grounding: a POI inside a park resolves to the smallest
containing boundary (the park) instead of the city, sharpening news/event
search relevance.

## Files

- `fetch_summit_metro_parks.py` — re-runnable fetch/convert tool (no deps)
- `summit_metro_parks.manifest.json` — generated index (OSM IDs, geometry types)
- `insert_summit_metro_parks.sql` — generated import script
- `<park>.geojson` — one EPSG:4326 FeatureCollection per park (15 files)

## Data Source

- **Source:** OpenStreetMap via Overpass API
- **License:** ODbL 1.0 (http://osm.org/copyright)
- **Retrieved:** 2026-05-21
- **Endpoint:** `overpass.kumi.systems` — the canonical `overpass-api.de`
  returns HTTP 406 from some hosts; the kumi mirror works.
- **Note:** OSM `operator` tags for SMP are inconsistent ("Summit Metro Parks",
  "Summit County Metroparks", "Metro Parks, Serving Summit County", or blank),
  so the fetch tool pins explicit OSM way/relation IDs rather than filtering by
  operator.

## Schema (current model — NOT legacy `poi_type`)

Park boundaries are rows in `pois`:

- `poi_roles` — `ARRAY['boundary']`
- `boundary_type` — `'park'` (drives the **Parks** section of the map panel;
  municipal boundaries use `municipal`/`city`/`township`/`village`/`county`/`state`)
- `boundary_color` — hex string
- `geometry` — GeoJSON Polygon/MultiPolygon (JSONB)
- `boundary_geom` — PostGIS `geometry(MultiPolygon,4326)`, backfilled from
  `geometry`. **This is the column geographic grounding actually reads**
  (`geoService.getContainingBoundaries` → `ST_Contains` / `ST_Area`).

> ⚠️ `server.js` startup stamps `boundary_type='municipal'` onto any boundary
> with a NULL type. The import script sets `'park'` explicitly so parks are not
> silently reclassified into the Municipal section on the next restart.

## Parks Included

| Park | Color | OSM ID | Geometry | Points |
|------|-------|--------|----------|--------|
| Cascade Valley Metro Park | `#2E8B57` | relation/14962727 | MultiPolygon | 216 |
| Confluence Metro Park | `#3CB371` | way/1183430028 | Polygon | 51 |
| Deep Lock Quarry Metro Park | `#6B8E23` | way/1118934213 | Polygon | 99 |
| F.A. Seiberling Nature Realm | `#48A860` | way/321864947 | Polygon | 16 |
| Firestone Metro Park | `#556B2F` | way/279928717 | Polygon | 63 |
| Furnace Run Metro Park | `#808000` | relation/1290126 | Polygon | 278 |
| Goodyear Heights Metro Park | `#228B22` | way/422736187 | Polygon | 62 |
| Gorge Metro Park | `#008B8B` | way/324814067 | Polygon | 281 |
| Hampton Hills Metro Park | `#66CDAA` | way/515714240 | Polygon | 40 |
| Munroe Falls Metro Park | `#5F9EA0` | way/324817710 | Polygon | 79 |
| Nimisila Reservoir Metro Park | `#2F8F6F` | way/1119378323 | Polygon | 107 |
| O'Neil Woods Metro Park | `#9ACD32` | way/323043456 | Polygon | 65 |
| Sand Run Metro Park | `#388E5C` | way/323083638 | Polygon | 445 |
| Silver Creek Metro Park | `#4F7942` | way/279929012 | Polygon | 69 |
| Springfield Bog Metro Park | `#7BA05B` | way/279927827 | Polygon | 31 |

## Known Gaps (fallback / future work)

- **Liberty Park** — included as a **4-way union** (~2,033 ac), not the single
  OSM relation 6883851 (which is only ~33 ac). OSM maps Liberty Park as several
  *overlapping* ways — `Liberty Park` ×2 (the southern/Pond Brook end), `Liberty
  Park Nature Area`, and `Liberty Park Recreation` (the Ledges core); these are
  unioned via `UNION_ROSTER` in the fetch tool and dissolved with `ST_UnaryUnion`
  at import (see note below). Both `Liberty Park` and `Liberty Park Nature Center`
  POIs ground correctly to it.

  > **Why the import dissolves geometry:** the four Liberty Park ways overlap.
  > A naive `ST_MakeValid` on an overlapping MultiPolygon punches the overlap out
  > as an interior ring (even-odd rule) — which rendered as a "square cut out" of
  > the developed core and left POIs there ungrounded. `ST_UnaryUnion` merges
  > overlapping parts into clean, hole-free coverage. The import rewrites both the
  > `geometry` JSONB (map rendering) and `boundary_geom` (grounding) from it.
- **Cascade Valley Metro Park** — included (MultiPolygon, ~509 ac) but
  under-captures the full ~1,140-acre footprint; the master relation omits some
  outlying areas. Covers the developed North/South/Cascade Locks/Valley View
  cores where POI density is highest.
- **Summit Lake** — omitted pending ownership verification (the lakefront park
  land is shared/ambiguous between the City of Akron and SMP's nature center).
- **Conservation areas** (Pond Brook, Schumacher Woods, Theiss Woods, Mud
  Catcher) — largely absent from OSM; tracing/county-GIS candidates.

## Regenerate

```bash
python3 fetch_summit_metro_parks.py            # refresh geojson + manifest
# (then regenerate insert_summit_metro_parks.sql — see commit tooling)
```

## Local Import

```bash
./run.sh start
podman cp data/boundaries/insert_summit_metro_parks.sql rotv:/tmp/
podman exec rotv psql -U postgres -d rotv -f /tmp/insert_summit_metro_parks.sql
```

## Production Upload

```bash
scp -P 22422 data/boundaries/insert_summit_metro_parks.sql root@lotor.dc3.crunchtools.com:/tmp/
ssh -p 22422 root@lotor.dc3.crunchtools.com \
  "podman cp /tmp/insert_summit_metro_parks.sql rootsofthevalley.org:/tmp/ && \
   podman exec rootsofthevalley.org psql -U rotv rotv -f /tmp/insert_summit_metro_parks.sql"
```


---

# Cleveland Metroparks Boundaries (Issue #198, Priority 1)

All 18 Cleveland Metroparks reservations (the "Emerald Necklace"). Same
model and tooling as the Summit Metro Parks set.

## Files

- `fetch_cleveland_metroparks.py` — re-runnable fetch tool (imports the shared
  helpers from `fetch_summit_metro_parks.py`: Overpass mirror fallback, way/
  relation geometry, multi-relation union)
- `cleveland_metroparks.manifest.json` — generated index
- `insert_cleveland_metroparks.sql` — generated import (ST_UnaryUnion dissolve)
- `<reservation>.geojson` — one EPSG:4326 FeatureCollection per reservation

## Data Source

- **Source:** OpenStreetMap via Overpass API — **License:** ODbL 1.0
- **Retrieved:** 2026-05-21
- Cleveland Metroparks reservations are well mapped as relations with a mostly
  consistent `operator=Cleveland Metroparks` tag, but IDs are still pinned
  explicitly (Brookside's operator is blank). Ohio & Erie Canal Reservation is
  two relations (nature_reserve + park), unioned via `UNION_REL_ROSTER`.
- Excludes **Columbia Reservation** (it's Lorain County Metro Parks, not CM) and
  non-reservation small parks (Wendy Park, Wildwood, etc.).

## Reservations Included

| Reservation | Color | OSM ID | Points |
|-------------|-------|--------|--------|
| Acacia Reservation | `#1F6F4A` | way/297396089 | 135 |
| Bedford Reservation | `#2E8B57` | relation/3956286 | 777 |
| Big Creek Reservation | `#3CB371` | relation/3956339 | 994 |
| Bradley Woods Reservation | `#228B22` | relation/11230155 | 231 |
| Brecksville Reservation | `#006400` | relation/7081545 | 1757 |
| Brookside Reservation | `#556B2F` | relation/3956352 | 318 |
| Cleveland Lakefront Reservation | `#1E90FF` | relation/3958536 | 655 |
| Euclid Creek Reservation | `#20B2AA` | relation/3958520 | 322 |
| Garfield Park Reservation | `#6B8E23` | relation/3956380 | 171 |
| Hinckley Reservation | `#008B8B` | relation/3956228 | 293 |
| Huntington Reservation | `#4682B4` | way/999310008 | 29 |
| Mill Stream Run Reservation | `#2F8F6F` | relation/3951437 | 1232 |
| North Chagrin Reservation | `#388E5C` | relation/3954790 | 344 |
| Ohio & Erie Canal Reservation | `#9ACD32` | relations/3956408,11259162 | 1347 |
| Rocky River Reservation | `#5F9EA0` | relation/2292887 | 1191 |
| South Chagrin Reservation | `#48A860` | relation/3956204 | 1013 |
| Washington Reservation | `#7BA05B` | relation/3956422 | 281 |
| West Creek Reservation | `#66CDAA` | relation/11228395 | 237 |

## Pre-existing POIs handled

Three reservations already existed as content-bearing POIs. `Brecksville
Reservation` was a `point,boundary` row mis-tagged `municipal` (so it showed in
the Municipal panel and carried 1 news item). The import **demotes** any such
pre-existing `point+boundary` row for these names to a point-only marker —
preserving its news/events — so the clean OSM boundary we insert is the single
park boundary. `Garfield Park Reservation` and `West Creek Reservation` were
already point-only markers (with news/events) and simply coexist with their new
boundary polygons.

## Local / Production Import

```bash
# Local
podman cp data/boundaries/insert_cleveland_metroparks.sql rotv:/tmp/
podman exec rotv psql -U postgres -d rotv -f /tmp/insert_cleveland_metroparks.sql
# Production (lotor)
scp -P 22422 data/boundaries/insert_cleveland_metroparks.sql root@lotor.dc3.crunchtools.com:/tmp/
ssh -p 22422 root@lotor.dc3.crunchtools.com \
  "podman cp /tmp/insert_cleveland_metroparks.sql rootsofthevalley.org:/tmp/ && \
   podman exec rootsofthevalley.org psql -U rotv rotv -f /tmp/insert_cleveland_metroparks.sql"
```


---

# Smaller Municipal / City Parks (Issue #198, Priority 3)

Individually-owned city/village parks that contain ROTV point-POIs which
previously grounded only to their municipality. Same model and tooling as the
metroparks sets.

## Files

- `discover_municipal_parks.py` — discovery helper (searches OSM park polygons
  near each un-parked POI; read-only, prints candidates)
- `fetch_municipal_parks.py` — re-runnable fetch tool (imports the shared helpers
  from `fetch_summit_metro_parks.py`); emits geojson + manifest **and** the SQL
- `municipal_parks.manifest.json` — generated index
- `insert_municipal_parks.sql` — generated import (ST_UnaryUnion dissolve)
- `<park>.geojson` — one EPSG:4326 FeatureCollection per park (6 files)

## Data Source

- **Source:** OpenStreetMap via Overpass API — **License:** ODbL 1.0
- **Retrieved:** 2026-05-22 — IDs pinned explicitly (operator tags vary).

## Parks Included

| Park | Municipality | Color | OSM ID | Operator |
|------|--------------|-------|--------|----------|
| Cascade Park | Akron | `#B0894F` | ways/464364020,1091919433 (union) | City of Akron |
| Schneider Park | Akron | `#A0786B` | way/633129749 | City of Akron |
| Summit Lake Park | Akron | `#5FA0C0` | way/472101121 | City of Akron |
| Canal Basin Park | Cleveland | `#C08040` | way/1266663439 | City of Cleveland |
| Rivergate Park | Cleveland | `#6FAF8F` | way/1011021052 | Cleveland Metroparks |
| Valley View Woods | Valley View | `#8FAF5F` | relation/18057126 | Village of Valley View |

All six pre-existed only as point-only POIs (or not at all), so — like Garfield
Park / West Creek in the Cleveland set — they coexist with their new boundaries;
no demote was needed.

**Grounding payoff (local):** 8 point-POIs now resolve to one of these parks —
Cascade Park 3 (incl. Mustill Store / Mustill Lock 15), Rivergate Park 2 (incl.
Merwin's Warf), Canal Basin / Schneider / Valley View Woods 1 each.

## Known Gaps (not added)

- **Summit Lake NorthShore Park** — the POI sits ~200 m north of the only mapped
  OSM "Summit Lake Park" polygon (the north-shore park isn't drawn in OSM), so it
  still grounds to Akron. The boundary is kept anyway (Liberty-Park precedent — a
  valid park polygon useful for future POIs); fix needs a north-shore polygon or a
  coordinate nudge.
- **Oak Grove Park (Brecksville)**, **Irish Town Bend Park (Cleveland)** — no
  `leisure=park` polygon in OSM (tracing / city-GIS candidates).
- **Peninsula Village parks** — those POIs are buildings (G.A.R. Hall, galleries);
  no distinct park area in OSM. They ground to Village of Peninsula.

## Local / Production Import

```bash
# Local
podman cp data/boundaries/insert_municipal_parks.sql rotv:/tmp/
podman exec rotv psql -U postgres -d rotv -f /tmp/insert_municipal_parks.sql
# Production (lotor)
scp -P 22422 data/boundaries/insert_municipal_parks.sql root@lotor.dc3.crunchtools.com:/tmp/
ssh -p 22422 root@lotor.dc3.crunchtools.com \
  "podman cp /tmp/insert_municipal_parks.sql rootsofthevalley.org:/tmp/ && \
   podman exec rootsofthevalley.org psql -U rotv rotv -f /tmp/insert_municipal_parks.sql"
```
