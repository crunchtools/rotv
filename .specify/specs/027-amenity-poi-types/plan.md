# Implementation Plan: Playground & Restroom Amenity POI Types

> **Spec ID:** 027-amenity-poi-types
> **Status:** Planning
> **Last Updated:** 2026-05-27
> **Estimated Effort:** M

## Summary

Add two icon-table POI types (playground, restroom) that auto-classify and appear
in the legend; seed ~240 OSM-sourced amenity POIs that fall inside park
boundaries (committed snapshot + idempotent importer keyed on `osm_id`); and skip
those types in batch news/events collection via a configurable excluded-types
setting and a small backend POI classifier.

## Architecture

### Data flow — types & legend
`icons` table rows → public `GET /api/admin/icons` → `iconConfig` in App.jsx →
`Map.jsx` builds legend from enabled icons + `iconUtils.getDestinationIconTypeFromConfig`
classifies each POI by name keyword → activity fallback. Adding two rows is all
that's needed; no frontend code change.

### Data flow — OSM import
Overpass (`leisure=playground`, `amenity=toilets`, 2-county bbox) → filter to
points inside `boundary_type='park'` polygons (done during dev) → committed
`backend/data/osm/amenities.json` (240 features: osm_id, kind, lat, lon, osm_name,
park) → `import-osm-amenities.js` upserts point POIs by `osm_id`.

### Data flow — collection skip
`getAllPoisForCollection` / `getPoisForTierCollection` load
`news_collection_excluded_types` + icon config, classify each candidate via
`backend/utils/poiClassify.js`, and drop excluded types before returning ids.

## Implementation Steps

### Phase 1: Types, schema, icons
- [ ] `backend/migrations/066_add_amenity_poi_types.sql`: insert playground +
      restroom icons; `ALTER TABLE pois ADD COLUMN osm_id` + unique partial index;
      seed `news_collection_excluded_types` setting.
- [ ] `frontend/public/icons/playground.svg`, `restroom.svg` (32×32 badge style).

### Phase 2: OSM import
- [ ] `backend/data/osm/amenities.json` — committed snapshot (240 features). *(done)*
- [ ] `backend/migrations/import-osm-amenities.js` — read snapshot, build display
      name (osm_name → `"<park> <Kind>"` with per-park collision suffix), upsert
      point POIs by `osm_id` (poi_roles `{point}`, primary_activities, lat/lng,
      navigation_*, brief_description, collection_tier `monthly`). Idempotent.

### Phase 3: Collection skip
- [ ] `backend/utils/poiClassify.js` — `classifyPoiType(name, primaryActivities, iconConfig)`
      (port of the keyword→fallback core of `getDestinationIconTypeFromConfig`).
- [ ] Modify `getAllPoisForCollection` + `getPoisForTierCollection` in
      `newsService.js` to drop excluded types (load setting + icon config once).

### Phase 4: Tests
- [ ] Unit test `poiClassify` (playground/restroom/other) and that the excluded
      set removes amenity POIs from selection.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `backend/migrations/066_add_amenity_poi_types.sql` | icons + osm_id column + setting |
| `backend/migrations/import-osm-amenities.js` | idempotent OSM POI importer |
| `backend/data/osm/amenities.json` | committed 240-feature OSM snapshot |
| `backend/utils/poiClassify.js` | backend POI type classifier |
| `frontend/public/icons/playground.svg`, `restroom.svg` | type icons |
| `backend/tests/poiClassify.test.js` | unit tests |

### Modified Files
| File | Changes |
|------|---------|
| `backend/services/newsService.js` | excluded-type filtering in the two selection helpers |

## Database Migrations

`066_add_amenity_poi_types.sql` — idempotent (ON CONFLICT / IF NOT EXISTS),
re-runs safely every deploy. The OSM POI rows are loaded by the importer
(`node /app/migrations/import-osm-amenities.js`), run once at deploy after the
image is pulled — same manual pattern as `load-county-state-boundaries.js`.

## Testing Strategy

### Manual
1. Map legend shows Playground + Restroom toggles with icons; toggling filters markers.
2. Click a park (e.g. Rocky River Reservation) → playground/restroom pins inside it.
3. Amenity POI sidebar shows no News/Events tabs.
4. Trigger a batch collection dry-run / inspect selected ids → no amenity POIs.
5. Regular POIs still collect.

### Build / Gates
- [ ] `./run.sh build` passes
- [ ] `./run.sh test` (new unit test) — run by /deploy after merge
- [ ] gourmand `--full .` clean
- [ ] Gatehouse review clean

## Rollback Plan
1. Revert the PR. The `osm_id` column and seeded icons are additive and harmless;
   amenity POIs can be soft-deleted by `osm_id` if needed.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Duplicate POIs on re-import | Med | Upsert keyed on unique `osm_id` |
| Misclassification skips a real POI from collection | Med | Classify against full icon config; excluded set is narrow + admin-configurable |
| OSM names mostly missing | Low | Fall back to `"<park> <Kind>"` with collision suffix |
| Stale OSM data | Low | Snapshot committed + dated; refetch to refresh |

## Changelog
| Date | Changes |
|------|---------|
| 2026-05-27 | Initial plan |
