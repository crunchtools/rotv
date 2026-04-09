# Implementation Plan: POI Metadata Fields (Cost, Hours, Mobility)

> **Spec ID:** 005-poi-metadata-fields
> **Status:** Planning
> **Last Updated:** 2026-04-04
> **Estimated Effort:** S (Small - schema addition with minimal frontend changes)

## Summary

Add three new fields to the `pois` table (cost, hours, mobility) with database constraints, update API responses to include the new fields, and modify the frontend POI detail view to display them when present.

---

## Architecture

### Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│                     Database (PostgreSQL)                │
│                                                          │
│   ┌──────────────────────────────────────────────┐     │
│   │  pois table                                   │     │
│   │  + cost VARCHAR(50)       (CHECK constraint) │     │
│   │  + hours TEXT                                 │     │
│   │  + mobility VARCHAR(50)   (CHECK constraint) │     │
│   └──────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                 Backend API (Node.js/Express)            │
│                                                          │
│   GET /api/pois/:id → returns new fields                │
│   GET /api/pois → returns new fields                    │
│   POST /api/admin/pois → accepts new fields             │
│   PUT /api/admin/pois/:id → accepts new fields          │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│              Frontend (React)                            │
│                                                          │
│   ┌──────────────────────────────────────────┐         │
│   │  Sidebar.jsx                             │         │
│   │  + Display "Visit Information" section   │         │
│   │  + Show cost with icon                   │         │
│   │  + Show hours with icon                  │         │
│   │  + Show mobility with icon               │         │
│   └──────────────────────────────────────────┘         │
│                                                          │
│   ┌──────────────────────────────────────────┐         │
│   │  AdminPanel.jsx (POI create/edit form)   │         │
│   │  + Add cost dropdown                     │         │
│   │  + Add hours text input                  │         │
│   │  + Add mobility dropdown                 │         │
│   └──────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

1. Admin creates/edits POI with new fields via admin panel
2. POST/PUT request to backend with cost, hours, mobility
3. Backend validates and stores in pois table
4. GET requests return new fields in JSON responses
5. Frontend displays fields in POI detail sidebar (if present)

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Database constraints | PostgreSQL CHECK | Enforce data integrity at database level |
| Hours storage | TEXT (freeform) | Flexible for irregular hours ("Seasonal", "By appointment") |
| Cost/mobility storage | VARCHAR with ENUM | Constrained set of values, easy to filter later |

---

## Implementation Steps

### Phase 1: Database Migration

- [ ] Create migration file `017_add_poi_metadata_fields.sql`
- [ ] Add cost, hours, mobility columns to pois table
- [ ] Add CHECK constraints for cost and mobility values
- [ ] Add COMMENT documentation for each column
- [ ] Test migration on development database

### Phase 2: Backend API Updates

- [ ] Verify GET endpoints return new fields (likely automatic via SELECT *)
- [ ] Update POST /api/admin/pois to accept new fields
- [ ] Update PUT /api/admin/pois/:id to accept new fields
- [ ] Add validation for cost/mobility enum values in request handlers
- [ ] Test API with integration tests

### Phase 3: Frontend POI Detail View

- [ ] Update `Sidebar.jsx` to display new "Visit Information" section
- [ ] Add cost display with icon/label
- [ ] Add hours display with icon
- [ ] Add mobility display with icon/label
- [ ] Handle NULL values gracefully (hide section if no data)
- [ ] Test in browser

### Phase 4: Admin Panel Updates

- [ ] Update POI create/edit form with new fields
- [ ] Add cost dropdown (Free, Low, Medium, High, Not specified)
- [ ] Add hours text input
- [ ] Add mobility dropdown (Full, Limited, Accessible, Not specified)
- [ ] Test form submission and validation

### Phase 5: Testing & Documentation

- [ ] Run full test suite
- [ ] Manual testing in development container
- [ ] Update API documentation (if exists)
- [ ] Verify backward compatibility (existing POIs with NULL values)

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/017_add_poi_metadata_fields.sql` | Database migration |

### Modified Files

| File | Changes |
|------|---------|
| `backend/routes/admin.js` | Add validation for cost/mobility enums in POST/PUT handlers |
| `frontend/src/components/Sidebar.jsx` | Add "Visit Information" section to display new fields |
| `frontend/src/components/AdminPanel.jsx` | Add form inputs for cost, hours, mobility |

---

## Database Migrations

```sql
-- Migration: 017_add_poi_metadata_fields
-- Description: Adds cost, hours, and mobility accessibility fields to pois table

ALTER TABLE pois
  ADD COLUMN cost VARCHAR(50),
  ADD COLUMN hours TEXT,
  ADD COLUMN mobility VARCHAR(50);

ALTER TABLE pois
  ADD CONSTRAINT pois_cost_check
  CHECK (cost IS NULL OR cost IN ('free', 'low', 'medium', 'high'));

ALTER TABLE pois
  ADD CONSTRAINT pois_mobility_check
  CHECK (mobility IS NULL OR mobility IN ('full', 'limited', 'accessible'));

COMMENT ON COLUMN pois.cost IS 'Cost level: free (no charge), low ($1-10), medium ($11-25), high ($26+)';
COMMENT ON COLUMN pois.hours IS 'Operating hours (freeform text): "9am-5pm Mon-Fri", "Dawn to dusk", "24/7", "Seasonal: May-Oct"';
COMMENT ON COLUMN pois.mobility IS 'Accessibility level: full (no limitations), limited (some obstacles), accessible (wheelchair/mobility device friendly)';
```

---

## API Implementation

### Endpoint: `POST /api/admin/pois`

**Request:**
```json
{
  "name": "Brandywine Falls",
  "latitude": 41.2611,
  "longitude": -81.5592,
  "cost": "free",
  "hours": "Dawn to dusk year-round",
  "mobility": "limited",
  "brief_description": "65-foot waterfall with boardwalk viewing platform"
}
```

**Validation:**
- `cost` must be one of: `free`, `low`, `medium`, `high`, or `null`
- `hours` can be any text (up to TEXT field limit)
- `mobility` must be one of: `full`, `limited`, `accessible`, or `null`

**Response:**
```json
{
  "id": 123,
  "name": "Brandywine Falls",
  "cost": "free",
  "hours": "Dawn to dusk year-round",
  "mobility": "limited",
  ...
}
```

---

## Testing Strategy

### Integration Tests

- [ ] `backend/tests/poi.integration.test.js` - Test GET /api/pois/:id includes new fields
- [ ] `backend/tests/admin.integration.test.js` - Test POST /api/admin/pois with new fields
- [ ] `backend/tests/admin.integration.test.js` - Test PUT /api/admin/pois/:id with new fields
- [ ] `backend/tests/validation.test.js` - Test cost/mobility enum validation

### Manual Testing

1. Start development container: `./run.sh start`
2. Open admin panel and create a new POI with cost=free, hours="9am-5pm", mobility=accessible
3. Verify POI detail view displays the new fields correctly
4. Edit POI and change values, verify updates work
5. Create POI without new fields (NULL), verify frontend handles gracefully

---

## Rollback Plan

If issues are discovered:
1. Revert migration: `ALTER TABLE pois DROP COLUMN cost, DROP COLUMN hours, DROP COLUMN mobility;`
2. Redeploy previous version
3. Database rollback has no data loss risk (additive-only migration)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Frontend breaks on NULL values | Medium | Defensive coding: check for null/undefined before rendering |
| Invalid enum values stored | Low | Database CHECK constraints prevent this |
| Hours text field too short | Low | Using TEXT type (unlimited length) |
| Performance impact on large queries | Low | No indexes needed for MVP; can add later if filtering is implemented |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-04-04 | Initial plan |
