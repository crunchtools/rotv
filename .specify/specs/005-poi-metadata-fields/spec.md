# Specification: POI Metadata Fields (Cost, Hours, Mobility)

> **Spec ID:** 005-poi-metadata-fields
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-04-04

## Overview

Adds essential trip planning metadata to POIs: cost information, operating hours, and mobility accessibility levels. These fields enable users to filter and plan visits based on budget, schedule constraints, and physical accessibility needs.

---

## User Stories

### Trip Planning

**US-005-01: Filter by Cost**
> As a budget-conscious visitor, I want to see the cost of activities and destinations so that I can plan trips within my budget.

Acceptance Criteria:
- [ ] POIs can store cost information (free, low, medium, high)
- [ ] Cost is displayed on POI detail view
- [ ] Users can filter POIs by cost level (future enhancement)

**US-005-02: Check Operating Hours**
> As a visitor, I want to know when a destination is open so that I can plan my visit during operating hours.

Acceptance Criteria:
- [ ] POIs can store operating hours as text (e.g., "9am-5pm daily", "Dawn to dusk", "24/7")
- [ ] Hours are displayed prominently on POI detail view
- [ ] Closed/seasonal destinations show appropriate messaging

**US-005-03: Assess Accessibility**
> As a visitor with mobility limitations, I want to know the accessibility level of trails and destinations so that I can choose appropriate activities.

Acceptance Criteria:
- [ ] POIs can store mobility level (full, limited, accessible)
- [ ] Mobility level is displayed with clear iconography
- [ ] Users can filter POIs by mobility level (future enhancement)

---

## Data Model

### Schema Changes

```sql
-- Migration: 017_add_poi_metadata_fields
-- Adds cost, hours, and mobility fields to pois table

ALTER TABLE pois
  ADD COLUMN cost VARCHAR(50),           -- 'free', 'low', 'medium', 'high', NULL
  ADD COLUMN hours TEXT,                 -- Freeform text: "9am-5pm daily", "Dawn to dusk", etc.
  ADD COLUMN mobility VARCHAR(50);       -- 'full', 'limited', 'accessible'

-- Add check constraint for cost values
ALTER TABLE pois
  ADD CONSTRAINT pois_cost_check
  CHECK (cost IS NULL OR cost IN ('free', 'low', 'medium', 'high'));

-- Add check constraint for mobility values
ALTER TABLE pois
  ADD CONSTRAINT pois_mobility_check
  CHECK (mobility IS NULL OR mobility IN ('full', 'limited', 'accessible'));

-- Comment documentation
COMMENT ON COLUMN pois.cost IS 'Cost level: free (no charge), low ($1-10), medium ($11-25), high ($26+)';
COMMENT ON COLUMN pois.hours IS 'Operating hours (freeform text): "9am-5pm Mon-Fri", "Dawn to dusk", "24/7", "Seasonal: May-Oct"';
COMMENT ON COLUMN pois.mobility IS 'Accessibility level: full (no limitations), limited (some obstacles), accessible (wheelchair/mobility device friendly)';
```

### Field Definitions

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `cost` | VARCHAR(50) | `free`, `low`, `medium`, `high`, `NULL` | Cost category for visiting |
| `hours` | TEXT | Freeform text | Operating hours or availability |
| `mobility` | VARCHAR(50) | `full`, `limited`, `accessible`, `NULL` | Physical accessibility level |

**Cost Categories:**
- `free` - No cost to access
- `low` - $1-10 per person
- `medium` - $11-25 per person
- `high` - $26+ per person

**Mobility Levels:**
- `full` - Requires full mobility (e.g., rugged trails, steep terrain)
- `limited` - Some physical limitations acceptable (moderate trails, uneven surfaces)
- `accessible` - Wheelchair/mobility device accessible (paved paths, ramps, smooth surfaces)

---

## API Endpoints

### Modified Endpoints

| Method | Path | Changes |
|--------|------|---------|
| GET | `/api/pois` | Returns new `cost`, `hours`, `mobility` fields in response |
| GET | `/api/pois/:id` | Returns new fields in POI detail |
| POST | `/api/admin/pois` | Accepts new fields in request body (admin only) |
| PUT | `/api/admin/pois/:id` | Accepts new fields for updates (admin only) |

**Example Response:**
```json
{
  "id": 42,
  "name": "Ledges Trail",
  "cost": "free",
  "hours": "Dawn to dusk year-round",
  "mobility": "limited",
  "brief_description": "Rocky trail with scenic overlooks",
  ...
}
```

---

## UI/UX Requirements

### POI Detail View Updates

**Display Format:**
- **Cost:** Icon + label (💵 Free, 💵 Low ($), 💵💵 Medium ($$), 💵💵💵 High ($$$))
- **Hours:** 🕐 + hours text (e.g., "9am-5pm Mon-Fri")
- **Mobility:** Icon + label (♿ Accessible, ⚠️ Limited Mobility, 🥾 Full Mobility Required)

**Layout:**
Add a "Visit Information" section in the POI sidebar:
```
┌─────────────────────────────────┐
│ Visit Information               │
├─────────────────────────────────┤
│ 💵 Free                         │
│ 🕐 Dawn to dusk year-round      │
│ ⚠️ Limited Mobility OK          │
└─────────────────────────────────┘
```

### Admin Panel Updates

**POI Create/Edit Form:**
- Cost dropdown: [Not specified, Free, Low ($1-10), Medium ($11-25), High ($26+)]
- Hours text field: "Enter operating hours (e.g., '9am-5pm daily', 'Dawn to dusk')"
- Mobility dropdown: [Not specified, Full Mobility Required, Limited Mobility OK, Wheelchair Accessible]

---

## Non-Functional Requirements

**NFR-005-01: Data Integrity**
- Database constraints ensure only valid cost/mobility values
- NULL values allowed (not all POIs have cost/hours/mobility info)
- Hours field accepts freeform text for flexibility

**NFR-005-02: Backward Compatibility**
- Existing POIs have NULL for new fields (graceful degradation)
- Frontend handles NULL values by hiding sections when no data present
- Migration is additive only (no data loss risk)

**NFR-005-03: Performance**
- No indexes needed initially (filtering not implemented yet)
- Consider adding indexes if filter-by-cost/mobility features added later

---

## Dependencies

- None (standalone schema enhancement)

---

## Open Questions

1. Should hours be structured data (JSON with day-of-week fields) or freeform text?
   - **Decision:** Freeform text for MVP. Most POIs have irregular hours ("Seasonal", "By appointment"). Structured parsing can be added later if needed.

2. Should cost be stored as exact dollar amounts or categories?
   - **Decision:** Categories for simplicity. Exact pricing changes frequently; categories are more durable.

3. Should we migrate existing POI data to populate these fields?
   - **Decision:** No automatic migration. Admin users will populate these fields over time via the admin panel. Blank fields are acceptable for MVP.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-04-04 | Initial draft |
