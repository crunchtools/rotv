# Implementation Plan: GeoFenced and Associated News & Events

> **Spec ID:** 026-geofenced-news
> **Status:** Planning
> **Last Updated:** 2026-05-27
> **Estimated Effort:** M

## Summary

Add a backend helper that expands a target POI id into the set of POI ids whose
news/events should be shown — `[id]` for a normal point, the contained POIs for a
boundary, and the owned/associated POIs (plus POIs inside owned park boundaries)
for an organization. Three existing read endpoints query `poi_id = ANY(ids)` and
return each item's source POI name; the two sidebar tab components label rolled-up
items and link them to their own permalink.

---

## Architecture

### Data Flow

1. User selects a boundary or org in the map → Sidebar fetches
   `/api/pois/:id/tab-counts`, then `PoiNews`/`PoiEvents` fetch
   `/api/pois/:id/news` and `/api/pois/:id/events` (already keyed by `displayItem.id`).
2. Each endpoint calls `getRollupPoiIds(pool, id)` → array of POI ids.
3. The news/events/count SQL filters on `poi_id = ANY($ids)` and joins `pois`
   for the source name.
4. Frontend renders items; a source-POI label appears when the item's POI ≠ the
   page POI, and clicks build the permalink from the item's source POI slug.

### POI-id expansion (`getRollupPoiIds`)

```
ids = { targetId }
roles = target.poi_roles

if 'organization' in roles:
    owned ∪= SELECT id FROM pois WHERE owner_id = targetId AND not deleted
    owned ∪= SELECT physical_poi_id FROM poi_associations WHERE virtual_poi_id = targetId
    ids ∪= owned
    ids ∪= POIs whose point ⊂ boundary_geom of any owned boundary   (spatial)

if 'boundary' in roles AND target has boundary_geom:
    ids ∪= POIs whose point ⊂ target.boundary_geom                   (spatial)

return distinct ids
```

Spatial steps are wrapped so a PostGIS failure logs a warning and returns the
non-spatial ids (NFR-026-1). Point geometry per POI reuses the `CASE` expression
from `getContainingBoundaries` (point `geom`, else start point of `geometry`).

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Containment | PostGIS `ST_Contains` | Same pattern already in `geoService.js` |
| Expansion location | `backend/services/geoService.js` | Co-located with `getContainingBoundaries`; shared by all three endpoints |

---

## Implementation Steps

### Phase 1: Backend rollup helper

- [ ] Add `getRollupPoiIds(pool, poiId)` to `backend/services/geoService.js`
      returning a de-duplicated array of POI ids (always includes `poiId`).
- [ ] Non-spatial expansion (org owned + associated) runs first; spatial
      containment wrapped in try/catch with `[Geo]` warning + fallback.

### Phase 2: Wire endpoints

- [ ] `/api/pois/:id/news`: use `getRollupPoiIds`, `WHERE n.poi_id = ANY($1)`,
      `JOIN pois src ON src.id = n.poi_id`, return `n.poi_id`, `src.name AS poi_name`.
- [ ] `/api/pois/:id/events`: same expansion + `src.name AS poi_name`, `e.poi_id`.
- [ ] `/api/pois/:id/tab-counts`: count over `poi_id = ANY($ids)`.

### Phase 3: Frontend labeling + permalink

- [ ] `PoiNews.jsx`: show source-POI label when `Number(item.poi_id) !== Number(poiId)`;
      build slug from `item.poi_name || poiName`.
- [ ] `PoiEvents.jsx`: same.
- [ ] Minimal CSS for the source-POI label.

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/geoService.js` | Add `getRollupPoiIds` helper |
| `backend/server.js` | Rollup in `/news`, `/events`, `/tab-counts` handlers; return source POI name |
| `frontend/src/components/sidebar/PoiNews.jsx` | Source-POI label + permalink-by-source-slug |
| `frontend/src/components/sidebar/PoiEvents.jsx` | Source-POI label + permalink-by-source-slug |
| `frontend/src/App.css` (or component CSS) | `.poi-item-source` label style |

No new files, no migrations.

---

## API Implementation

### `GET /api/pois/:id/news` (boundary/org example)

**Response (rolled-up item gains `poi_id` + `poi_name`):**
```json
[
  {
    "id": 123,
    "title": "Trail reopens after storm",
    "summary": "...",
    "source_url": "https://...",
    "publication_date": "2026-05-20",
    "poi_id": 5536,
    "poi_name": "Old Portage Trail",
    "additional_urls": []
  }
]
```

---

## Testing Strategy

### Manual Testing

1. Click Brecksville Reservation (boundary) → News/Events tabs list items from
   POIs inside the boundary, each labeled with its POI name.
2. Click Cleveland Metroparks (org) → tabs list items from owned parks and POIs
   inside them.
3. Click a rolled-up item → opens that item's own permalink/detail.
4. Click a regular point POI → behaves exactly as before (own content only).
5. Boundary/org with zero rolled-up content → tabs hidden as before.

### Build / Quality Gates

- [ ] `./run.sh build` passes
- [ ] Human verification in browser (Phase 5)
- [ ] `gourmand --full .` clean
- [ ] Gatehouse review clean

---

## Rollback Plan

1. Revert the PR. No migrations or schema changes, so rollback is code-only.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large boundary (county/state) rolls up many items | Low | Existing `LIMIT` caps results; ordered newest-first |
| PostGIS query failure | Med | try/catch fallback to non-spatial expansion (NFR-026-1) |
| Rolled-up item permalink fails to resolve | Med | Navigate using item's source POI slug; App.jsx already resolves destinations/virtual/linear POIs (#412) |
| Spatial cost on every POI click | Low | Helper short-circuits to `[id]` for point POIs — no spatial query |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-27 | Initial plan |
