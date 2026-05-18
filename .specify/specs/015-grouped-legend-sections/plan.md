# Implementation Plan: Grouped Legend Sections + Astronomy

> **Spec ID:** 015-grouped-legend-sections
> **Status:** Planning
> **Last Updated:** 2026-05-18
> **Estimated Effort:** S

## Summary

Refactor the `Legend` component in `frontend/src/components/Map.jsx` into three collapsible sections; partition the existing boundary list by `boundary_type`; add an Astronomy activity + icon + Fairlawn Rotary Observatory POI via a single idempotent SQL migration.

---

## Architecture

### Component Layout

```
Legend (Map.jsx)
├── search input
├── LegendSection key="poi"  (open by default)
│     ├── header: chevron + "Points of Interest" + (N) + All/None
│     └── body: icon chips (existing .legend-icons grid)
├── LegendSection key="parks"  (collapsed by default)
│     ├── header: chevron + "Parks" + (N) + All/None
│     └── body: park boundary chips (existing .boundary-chips grid)
└── LegendSection key="municipal"  (collapsed by default)
      ├── header: chevron + "Municipal" + (N) + All/None
      └── body: municipal boundary chips (existing .boundary-chips grid)
```

### Data Flow

1. `App.jsx` fetches `/api/linear-features` (existing) — response already includes `boundary_type`.
2. `App.jsx` passes `linearFeatures` to `Map`.
3. `Map` partitions boundaries into two new props:
   - `parkBoundaries` = `boundary_type === 'park'`
   - `municipalBoundaries` = `boundary_type IN ('municipal','city','township','village','county','state')`
4. `Legend` renders three sections; local `useState` tracks open/closed.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Section toggle | React `useState` + native `hidden` attr | A11y-correct, no library needed |
| Chevron | Inline SVG with CSS rotate transition | Matches existing inline-SVG icon style |
| Section grouping | Client-side filter on existing `linearFeatures` payload | No API change, no new fetch |

---

## Implementation Steps

### Phase 1: Legend refactor (frontend)

- [ ] In `Map.jsx`, replace the existing two-section JSX inside `Legend` (lines 95–183) with three `LegendSection` blocks.
- [ ] Introduce `LegendSection` as a local component or render-helper inside `Map.jsx`.
- [ ] Add `useState({ poi: true, parks: false, municipal: false })` for open/closed.
- [ ] Replace the `boundaries` prop usage with `parkBoundaries` and `municipalBoundaries`.
- [ ] In `Map` function (line ~1468) replace the single `boundaries={...}` line with the two filtered props.
- [ ] In `App.jsx` (line ~2080) update `onShowAllBoundaries` to include all boundary types (`park`, `municipal`, `city`, `township`, `village`, `county`, `state`).
- [ ] Add CSS rules in `frontend/src/App.css` for `.legend-section`, `.legend-section-header`, `.legend-section-chevron`, and count badge.

### Phase 2: Astronomy data (backend migration)

- [ ] Create `backend/migrations/051_add_astronomy.sql`.
- [ ] Insert Astronomy activity (sort_order after current max).
- [ ] Insert astronomy icon with inline telescope SVG (style follows lighthouses icon #47).
- [ ] Insert Fairlawn Rotary Observatory POI.

### Phase 3: Build, verify, review

- [ ] `./run.sh build` (uses port 8081 from `.env`).
- [ ] `./run.sh start` and Scott verifies in browser.
- [ ] `./run.sh gatehouse` for review pass.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/051_add_astronomy.sql` | Seed Astronomy activity, icon, and Fairlawn Rotary POI |
| `.specify/specs/015-grouped-legend-sections/spec.md` | This feature's specification |
| `.specify/specs/015-grouped-legend-sections/plan.md` | This plan |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/Map.jsx` | Refactor `Legend` (lines 56–185); split `boundaries` prop at line 1468 into `parkBoundaries` + `municipalBoundaries` |
| `frontend/src/App.jsx` | Update `onShowAllBoundaries` at line ~2080 to include all boundary types |
| `frontend/src/App.css` | Add `.legend-section*` rules |

---

## Database Migrations

```sql
-- Migration: 051_add_astronomy
-- Description: Seed Astronomy activity, icon, and Fairlawn Rotary Observatory POI (closes #6)

DO $$
DECLARE
  next_sort INTEGER;
BEGIN
  -- Activity
  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO next_sort FROM activities;
  INSERT INTO activities (name, sort_order)
  VALUES ('Astronomy', next_sort)
  ON CONFLICT (name) DO NOTHING;

  -- Icon (with inline SVG)
  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO next_sort FROM icons;
  INSERT INTO icons (name, label, svg_content, title_keywords, activity_fallbacks, sort_order, enabled)
  VALUES (
    'astronomy', 'Astronomy',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#3b1f5b" stroke="white" stroke-width="2"/><circle cx="22" cy="9" r="1.3" fill="white"/><circle cx="10" cy="8" r="0.9" fill="white"/><circle cx="8" cy="14" r="0.7" fill="white"/><circle cx="24" cy="16" r="0.8" fill="white"/><path d="M9 25 L15 14 M11 25 L17 14 M9 25 L11 25 M22 12 L17 14 M22 12 L24 11" stroke="white" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    'observatory,telescope,planetarium,astronomy,stargazing,star party', 'Astronomy',
    next_sort, TRUE
  )
  ON CONFLICT (name) DO NOTHING;

  -- POI: Fairlawn Rotary Observatory
  IF NOT EXISTS (SELECT 1 FROM pois WHERE name = 'Fairlawn Rotary Observatory') THEN
    INSERT INTO pois (
      name, latitude, longitude, poi_roles, primary_activities,
      property_owner, brief_description, more_info_link
    )
    VALUES (
      'Fairlawn Rotary Observatory',
      41.1693, -81.6308,
      '{point}',
      'Astronomy',
      'Summit County Astronomy Club',
      'Free public observatory operated by the Summit County Astronomy Club at 4160 Ira Road, Bath, OH. Programs are weather and volunteer dependent — check the meetup for open nights. Ages 7+. Official James Webb Space Telescope site. The grounds include a 1.3-mile Walk of Planets (Sun to Pluto) built with Bath Township. Equipment includes a Celestron EdgeHD 14" on an Astro-Physics 1200 mount plus multiple 11" pier-mounted telescopes across two roll-off-roof buildings.',
      'https://www.meetup.com/summit-county-astronomy-meetup/'
    );
  END IF;
END $$;
```

---

## Testing Strategy

### Manual Testing

1. Load `http://localhost:8081` — POI expanded, Parks + Municipal collapsed.
2. Click each section header — only that section toggles; chevron rotates.
3. Use Parks All/None — toggles CVNP + Hampton Hills only.
4. Use Municipal All/None — toggles Akron + Cuyahoga Falls + counties + Ohio only.
5. POI section: confirm `Astronomy` chip with telescope icon appears.
6. Toggle Astronomy: Fairlawn Rotary pin appears in Bath OH; click pin → info panel shows meetup link, SCAC ownership, description.
7. Search box still narrows visible POIs.
8. Mobile (≤768px): outer legend collapse still works.

### Regression Checks

- Trails/Rivers layer chips still functional (verify placement during implementation).
- Existing visible boundaries (CVNP default-on) still render on map.
- Icon admin UI (`/admin` → Icons) shows the new Astronomy row.

---

## Rollback Plan

1. Revert PR via `gh pr revert`.
2. Drop the Fairlawn Rotary POI row, Astronomy icon row, Astronomy activity row if needed:
   ```sql
   DELETE FROM pois WHERE name = 'Fairlawn Rotary Observatory';
   DELETE FROM icons WHERE name = 'astronomy';
   DELETE FROM activities WHERE name = 'Astronomy';
   ```

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| County/state polygons large | Med | Sections default collapsed; render only on user toggle |
| Sparse Parks section (2 entries) | Low | Accepted — structure for forthcoming parks |
| Inline SVG icon may not read at chip scale | Low | Model after lighthouses #47; iterate via admin UI post-deploy |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-18 | Initial plan |
