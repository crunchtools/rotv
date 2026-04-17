# Implementation Plan: POI Roles

> **Spec ID:** 005-poi-roles
> **Status:** Planning
> **Last Updated:** 2026-04-17
> **Estimated Effort:** M

## Summary

Add a `poi_roles` TEXT[] column to the `pois` table, seeded from existing `poi_type` values. Write a migration that merges the four known boundary/virtual duplicate pairs and inserts Peninsula boundary GeoJSON. Update the API and admin UI to expose and edit roles.

---

## Architecture

### Data Flow

1. Migration adds `poi_roles` column and seeds from `poi_type`
2. Migration merges duplicate pairs (re-parents child rows, soft-deletes losers)
3. Migration adds Peninsula GeoJSON to existing "Village of Peninsula" POI
4. Backend API includes `poi_roles` in GET responses and accepts it in PUT
5. Admin UI gains a role tag editor on the POI edit form

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Role storage | `TEXT[]` (PostgreSQL array) | Simple, queryable with GIN index, no join table needed for current use |
| Role editing UI | Tag/chip input | Matches existing multi-value patterns in the admin form |

---

## Implementation Steps

### Phase 1: Database Migration

- [ ] Write migration `005_poi_roles.sql`
  - Add `poi_roles TEXT[] DEFAULT '{}'`
  - Seed from `poi_type`
  - Add GIN index
  - Merge Akron / City of Akron
  - Merge Cleveland / City of Cleveland
  - Merge Independence / Independence Township
  - Merge Valley View / Village of Valley View
  - Add Peninsula boundary GeoJSON to POI 5675

### Phase 2: Backend API

- [ ] Update `GET /api/destinations` to include `poi_roles`; stop reading `poi_type` for rendering decisions
- [ ] Update `GET /api/admin/destinations` to include `poi_roles`
- [ ] Update `PUT /api/admin/destinations/:id` to accept and persist `poi_roles`
- [ ] Remove any backend logic that gates rendering on `poi_type = 'virtual'`; gate on geometry presence instead

### Phase 3: Frontend Rendering

- [ ] Update map rendering to key off geometry presence/shape, not `poi_type`
- [ ] Remove all `poi_type === 'virtual'` guards — replace with `!geometry` checks
- [ ] POIs with no geometry are simply not rendered; no special type needed

### Phase 4: Admin UI

- [ ] Add `poi_roles` tag editor to POI edit form
- [ ] Display current roles as chips/tags
- [ ] Available roles: `trail`, `river`, `boundary`, `organization`, `attraction`, `point`
- [ ] Remove `virtual` from available `poi_type` options (deprecated)

### Phase 4: Testing

- [ ] Verify merged POIs have correct roles
- [ ] Verify child rows (news, events, associations) are correctly re-parented
- [ ] Verify Peninsula renders on map as boundary
- [ ] Run full test suite

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/005_poi_roles.sql` | Schema change + data merges + Peninsula GeoJSON |

### Modified Files

| File | Changes |
|------|---------|
| `backend/routes/admin.js` | Accept `poi_roles` in PUT; include in GET responses |
| `backend/routes/api.js` | Include `poi_roles` in public destinations response |
| `frontend/src/components/Admin/PoiEditForm.jsx` (or equivalent) | Add roles tag editor |

---

## Database Migrations

```sql
-- Migration 005: POI Roles
-- Adds poi_roles array, merges duplicate boundary/virtual pairs,
-- adds Peninsula boundary GeoJSON.

-- 1. Add column
ALTER TABLE pois ADD COLUMN IF NOT EXISTS poi_roles TEXT[] DEFAULT '{}';

-- 2. Seed from poi_type
UPDATE pois SET poi_roles = ARRAY[poi_type] WHERE poi_roles = '{}';

-- 3. GIN index
CREATE INDEX IF NOT EXISTS idx_pois_roles ON pois USING GIN (poi_roles);

-- 4-7. Merge pairs (see 005_poi_roles.sql for full implementation)

-- 8. Peninsula boundary
UPDATE pois SET geometry = '{"type":"Polygon","coordinates":...}'::jsonb,
  poi_type = 'boundary',
  poi_roles = ARRAY['boundary', 'organization']
WHERE id = 5675;
```

---

## Merge Strategy

For each pair, determine the survivor (the POI with the most associations/news or the most descriptive name) and re-parent child rows:

| Boundary ID | Virtual ID | Survivor | Rationale |
|-------------|------------|----------|-----------|
| 5686 Akron | 5656 City of Akron | 5656 | Virtual has org context + associations |
| 3884 Cleveland | 5657 City of Cleveland | 5657 | Virtual has org context |
| 3885 Independence | 5663 Independence Township | 5663 | Township is the correct legal name |
| 3889 Valley View | 5676 Village of Valley View | 5676 | Village is the correct legal name |

The boundary POI's geometry is copied to the survivor before soft-deleting.

---

## Testing Strategy

### Manual Testing

1. Confirm merged POIs appear once on the map with correct boundary rendering
2. Confirm Peninsula village boundary renders on map
3. Confirm news/events previously attached to deleted POIs now appear under survivors
4. Confirm admin POI edit form shows and saves roles

---

## Rollback Plan

1. Set `deleted = false` on soft-deleted POIs
2. Re-point child rows back to original POI IDs (captured in migration comments)
3. Drop `poi_roles` column

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Child row re-parenting creates duplicates | Med | Use INSERT ... ON CONFLICT DO NOTHING or check before insert |
| Frontend breaks on missing `poi_roles` field | Low | Default to `[]` in API response, handle null in UI |
| Peninsula GeoJSON is wrong boundary | Low | Verified from OSM relation 181945 |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-04-17 | Initial plan |
