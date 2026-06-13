# Implementation Plan: Water Taxi Landing Points as Full POIs

> **Spec ID:** 035-water-taxi-stop-pois
> **Status:** Planning
> **Last Updated:** 2026-06-13
> **Estimated Effort:** M

## Summary

Promote the four Harbor Hopper landing points into full point POIs via an
idempotent migration, add a reusable **Food & Drink** POI/icon type, link each
stop back to its route through `pois.stops[].poi_id` (so the map shows one marker,
the route lists its stops, and each stop shows its serving taxi), and fix the
linear-feature photo-upload defect by rendering the upload modal on the
linear-feature sidebar branch.

---

## Architecture

### Data Flow

1. **Migration 083** inserts the `food_drink` icon type, inserts the 4 stop point
   POIs at their landing-point coordinates, and writes `poi_id` back into the
   Harbor Hopper `stops` JSONB (matching by stop name).
2. **Map** renders stop POIs as ordinary POI markers; the decorative water-taxi
   circle is skipped for any stop whose entry now has a `poi_id`.
3. **Route sidebar** (Harbor Hopper) reads its `stops` array and renders an ordered,
   clickable "Stops" list (links resolve to the stop POIs).
4. **Stop sidebar** calls a served-by lookup that finds water-taxi POIs whose
   `stops` contain this POI's id, and renders a "Served by …" link back to the route.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Stop link | `pois.stops[].poi_id` JSONB | Single source of truth; preserves route order; avoids the org-only `poi_associations` UI |
| POI type | new `icons` row + `frontend/public/icons/food_drink.svg` | Same pattern as playground/restroom amenity types (spec 027) |
| Photo fix | render `MediaUploadModal` in the linear-feature branch | Mirrors the existing point-POI modal wiring |

---

## Implementation Steps

### Phase 1: Data (migration + asset)

- [ ] Add `frontend/public/icons/food_drink.svg` (simple fork/knife or mug glyph, matching existing icon style).
- [ ] `backend/migrations/083_water_taxi_stop_pois.sql`:
  - [ ] `INSERT INTO icons (food_drink, 'Food & Drink', 'food_drink.svg', <broad keywords>) ON CONFLICT (name) DO NOTHING`.
  - [ ] Insert 4 point POIs (Cleveland Water Taxi Main Hub, Flats East Bank, Collision Bend Brewing Company, BrewDog Cleveland Outpost) with `poi_roles='{point}'` + lat/lng from the Harbor Hopper `stops`. Idempotent (`WHERE NOT EXISTS` on name+point role).
  - [ ] Update the Harbor Hopper `stops` JSONB so each entry gains `poi_id` (subquery by stop `name` → new POI id). Idempotent (only set when missing).

### Phase 2: Backend (served-by lookup)

- [ ] Add `served_by` to the POI detail response (or a small `GET /api/pois/:id/serving-taxis`) returning `{id,name}` for any `water_taxi` POI whose `stops @>` `[{"poi_id": :id}]`. Read-only, public.

### Phase 3: Frontend (map + sidebar)

- [ ] `Map.jsx`: in the water-taxi stop loop, `if (stop.poi_id) return null;` so converted stops don't double-render.
- [ ] `iconUtils.js` / icon config: ensure `food_drink` resolves to its marker + add to the grouped legend (spec 015) with a "Food & Drink" toggle.
- [ ] Route sidebar (`ReadOnlyView` for linear features): render an ordered "Stops" list from `stops`, each clickable → `onSelectPoi`/destination.
- [ ] Stop sidebar (point `ReadOnlyView`): render "Served by <taxi>" from the served-by data, clickable → linear feature.

### Phase 4: Defect fix (linear-feature photo upload)

- [ ] `Sidebar.jsx`: inside the `if (isLinearFeature)` return block, render
  `{uploadModalOpen && linearFeature?.id && <MediaUploadModal poiId={linearFeature.id} … />}`,
  mirroring the point-POI block at ~line 1236. Mark with a `// Fix:` note.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/083_water_taxi_stop_pois.sql` | Food & Drink type, 4 stop POIs, stops[].poi_id backfill |
| `frontend/public/icons/food_drink.svg` | Food & Drink map/legend icon |

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | served-by lookup; ensure new columns/`stops.poi_id` reach the linear-feature serializer |
| `frontend/src/components/Map.jsx` | skip decorative circle when `stop.poi_id` set |
| `frontend/src/components/Sidebar.jsx` | render `MediaUploadModal` on linear-feature branch (defect fix) |
| `frontend/src/components/sidebar/ReadOnlyView.jsx` | route "Stops" list + stop "Served by" link |
| `frontend/src/utils/iconUtils.js` + legend config | `food_drink` marker + "Food & Drink" legend group |

---

## Testing Strategy

### Manual Testing

1. Harbor Hopper route shows 4 clickable stops in order; clicking opens each stop POI.
2. Collision Bend / BrewDog render with the Food & Drink icon; no leftover circle under the marker.
3. Each stop POI sidebar shows "Served by Harbor Hopper", clickable back to the route.
4. Upload a photo to the Harbor Hopper (and a river/trail) — modal opens, upload succeeds.
5. eLCee2 + its two docks are unchanged (still circles, no POIs).
6. Re-run the container (migration re-applies) — no duplicate POIs, no errors.

### Automated

- [ ] Existing Playwright/Vitest suites still pass (`./run.sh test`, run by `/deploy`).
- [ ] Add a unit test for the served-by query if a clean seam exists.

---

## Rollback Plan

1. Migration is idempotent and additive; to revert, delete the 4 stop POIs and the
   `food_drink` icon row, and null out `stops[].poi_id` (the circles return automatically).
2. Frontend changes are isolated; revert the branch.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Dock POIs (Main Hub, Flats East Bank) look generic as default pins | Low | Acceptable per spec Open Q1; revisit with a dock icon later |
| New POIs pull irrelevant Serper news | Low | No `news_url` (no Phase I); Phase II is grounded; can exclude later |
| Double markers if `poi_id` backfill misses a name | Med | Migration matches exact stop names; verified against migration 062 data |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-06-13 | Initial plan |
</content>
