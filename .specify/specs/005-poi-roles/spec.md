# Specification: POI Roles

> **Spec ID:** 005-poi-roles
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-04-17

## Overview

A single `poi_type` field currently conflates geometry shape (point, linestring, polygon) with semantic role (trail, organization, boundary, river). This forces duplicate POI rows for real-world entities that are both a geographic boundary and an organizational actor — e.g., "City of Akron" exists as both a `boundary` POI and a `virtual` POI. This spec adds a `poi_roles` array column so a single POI can carry multiple roles, then merges the known duplicate pairs and adds missing boundary data for Peninsula.

---

## User Stories

### Data Model

**US-005-01: Multiple roles per POI**
> As a data administrator, I want a single POI to carry multiple roles (e.g., `boundary` and `organization`) so that real-world entities are not duplicated in the database.

Acceptance Criteria:
- [ ] A POI can have one or more roles stored in a `poi_roles` array column
- [ ] Existing `poi_type` values are migrated to seed the initial roles
- [ ] The admin UI displays and allows editing of roles

**US-005-02: Duplicate pairs merged**
> As a data administrator, I want the known boundary/virtual duplicate pairs merged into single POIs so that news, events, and associations reference one authoritative record.

Acceptance Criteria:
- [ ] Akron / City of Akron merged into one POI
- [ ] Cleveland / City of Cleveland merged into one POI
- [ ] Independence / Independence Township merged into one POI
- [ ] Valley View / Village of Valley View merged into one POI
- [ ] All news, events, and associations from the deleted duplicate are re-parented to the surviving POI
- [ ] Deleted duplicates are soft-deleted

**US-005-03: Peninsula boundary added**
> As a map user, I want to see the Village of Peninsula boundary rendered on the map so that its geographic extent is visible alongside other municipal boundaries.

Acceptance Criteria:
- [ ] "Village of Peninsula" POI has polygon GeoJSON geometry from OSM
- [ ] Peninsula renders on the map as a boundary overlay
- [ ] The existing "Village of Peninsula" virtual POI (5675) gains the geometry rather than a new duplicate being created

---

## Data Model

### Schema Changes

```sql
-- Add poi_roles array column
ALTER TABLE pois ADD COLUMN poi_roles TEXT[] DEFAULT '{}';

-- Seed roles from existing poi_type
UPDATE pois SET poi_roles = ARRAY[poi_type];

-- Add index for role queries
CREATE INDEX idx_pois_roles ON pois USING GIN (poi_roles);
```

### Merge Strategy

For each duplicate pair, the boundary POI (has geometry) is merged into the virtual POI (has organizational context), keeping the virtual POI's ID as the survivor where it is already referenced by associations. Re-parent all `poi_news`, `poi_events`, `poi_media`, and `poi_associations` rows to the survivor, then soft-delete the duplicate.

---

## API Endpoints

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/destinations` | Include `poi_roles` in response |
| PUT | `/api/admin/destinations/:id` | Accept `poi_roles` array |
| GET | `/api/admin/destinations` | Include `poi_roles` in response |

---

## UI/UX Requirements

### Admin POI Edit Form

- Add a multi-select or tag input for `poi_roles`
- Available roles: `trail`, `river`, `boundary`, `organization`, `attraction`, `point`
- Display current roles as tags

---

## Non-Functional Requirements

**NFR-005-01: poi_type Deprecation**
- `poi_type` is deprecated in this release. `poi_roles` is the new source of truth for all role and rendering logic.
- `poi_type` column is retained in the database during the transition to avoid breaking existing queries, but the application will not write to it for new records and will not read from it for rendering decisions.
- `poi_type` will be dropped in a future MAJOR migration once all consumers are confirmed migrated.

**NFR-005-02: Geometry-Driven Rendering**
- Map rendering is driven solely by the presence and shape of geometry data, not by any type or role field.
- A POI with no geometry is never rendered on the map, regardless of its roles.
- A POI with geometry is rendered based on the GeoJSON geometry type: `Point` → marker, `LineString`/`MultiLineString` → path, `Polygon`/`MultiPolygon` → area overlay.
- The `virtual` poi_type concept is eliminated — organizational-only POIs simply have no geometry.

**NFR-005-03: Data Integrity**
- Merge migrations must be idempotent
- No orphaned `poi_news`, `poi_events`, or `poi_associations` rows after merge

---

## Open Questions

None — all design decisions resolved.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-04-17 | Initial draft |
