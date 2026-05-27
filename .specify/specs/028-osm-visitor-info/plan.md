# Implementation Plan: OSM-Sourced Visitor Info (Hours, Accessibility, Fee)

> **Spec ID:** 028-osm-visitor-info
> **Status:** Planning
> **Last Updated:** 2026-05-27
> **Estimated Effort:** M

## Summary

Add three optional POI columns (`opening_hours`, `wheelchair`, `fee`), display
them in the Side Panel's Visitor Information section, make them admin-editable,
and extend the existing OSM amenity snapshot + importer to auto-populate them.

---

## Data Flow

1. **Refresh OSM snapshot** — re-query Overpass for the region's playgrounds
   (`leisure=playground`) and toilets (`amenity=toilets`) with `out tags`,
   capture `opening_hours`/`wheelchair`/`fee` per feature, merge into
   `backend/data/osm/amenities.json` keyed by `osm_id` (keeps existing fields).
2. **Import** — `import-osm-amenities.js` writes the three fields on INSERT and,
   on `ON CONFLICT` UPDATE, refreshes them with `COALESCE(EXCLUDED.x, pois.x)`
   so a present DB value is never nulled by a tagless OSM feature.
3. **Read** — existing POI read endpoints already `SELECT *`; new columns flow to
   the frontend with no API change.
4. **Display/Edit** — `ReadOnlyView` renders rows; `EditView` + `admin.js`
   allowlists handle manual edits for any POI.

---

## Implementation Steps

### Phase 1: Schema
- [ ] `backend/migrations/067_osm_visitor_info.sql` — add 3 columns + CHECK
      constraints, idempotent (`ADD COLUMN IF NOT EXISTS`,
      `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`).

### Phase 2: Backend API
- [ ] Add `opening_hours`, `wheelchair`, `fee` to the 4 `allowedFields`
      allowlists in `backend/routes/admin.js`.

### Phase 3: OSM import
- [ ] Refresh `backend/data/osm/amenities.json` via Overpass to add the 3 tags.
- [ ] Extend `import-osm-amenities.js` INSERT column list + `ON CONFLICT` SET
      with COALESCE non-clobber semantics.

### Phase 4: Frontend
- [ ] `ReadOnlyView.jsx` — 3 conditional rows in Visitor Information grid, with
      a small display-mapping helper for wheelchair/fee labels.
- [ ] `EditView.jsx` — Hours text input + Accessibility/Fee selects.

### Phase 5: Build, verify, review
- [ ] `./run.sh build` then `./run.sh start` (port 8082, container rotv-osm-visitor).
- [ ] Human verification in browser.
- [ ] `gourmand --full .` + Gatehouse review.

---

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `backend/migrations/067_osm_visitor_info.sql` | Add 3 columns + constraints |
| `.specify/specs/028-osm-visitor-info/{spec,plan}.md` | Spec & plan |

### Modified Files
| File | Changes |
|------|---------|
| `backend/routes/admin.js` | Add 3 fields to 4 allowlists |
| `backend/migrations/import-osm-amenities.js` | Write/refresh 3 fields (COALESCE) |
| `backend/data/osm/amenities.json` | Add `opening_hours`/`wheelchair`/`fee` per feature |
| `frontend/src/components/sidebar/ReadOnlyView.jsx` | 3 display rows + label helper |
| `frontend/src/components/sidebar/EditView.jsx` | 3 edit inputs |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OSM re-import clobbers admin edits | Med | COALESCE(EXCLUDED, existing) on UPDATE |
| Sparse OSM coverage (few amenities tagged) | Low | Fields optional; rows hide when empty |
| Overpass refresh unavailable offline | Low | Snapshot is committed; import reads the file |
| CHECK constraint rejects unexpected OSM value | Low | Normalize/whitelist on import; skip unknowns |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-27 | Initial plan |
