# Specification: Water Taxi Landing Points as Full POIs

> **Spec ID:** 035-water-taxi-stop-pois
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-06-13

## Overview

The Harbor Hopper water taxi (spec 023) currently carries its landing points —
Cleveland Water Taxi Main Hub, Flats East Bank, Collision Bend Brewing Company,
and BrewDog Cleveland Outpost — as a decorative `stops` JSONB array rendered as
plain circles on the route line. These are real destinations (breweries, docks)
that deserve their own pages. This feature promotes each Harbor Hopper stop into
a full point POI with its own sidebar, photos, news, and events, introduces a
reusable **Food & Drink** POI type for the breweries/restaurants, and links each
stop back to the route it is served by.

It also fixes a defect that surfaced while testing this work: photos cannot be
uploaded to a linear-feature POI (the Harbor Hopper itself, rivers, trails) —
the "Add Photo/Video" button does nothing because the upload modal is never
rendered on the linear-feature code path.

---

## User Stories

### Landing Points as Destinations

**US-035-1: Explore a landing point as a full destination**
> As a map visitor, I want each Harbor Hopper stop to be a real place I can open
> so that I can see its photos, news, events, and details — not just a dot on a line.

Acceptance Criteria:
- [ ] Each of the four Harbor Hopper stops exists as a full point POI (own marker, sidebar, tabs).
- [ ] Stop POIs sit at their existing landing-point coordinates.
- [ ] Stop POIs support photos, news, and events through the existing POI flows.
- [ ] No duplicate marker: a stop that is now a POI no longer also renders as a decorative route circle.

**US-035-2: A reusable Food & Drink POI type**
> As an admin, I want a "Food & Drink" POI type so that breweries, pubs, and
> restaurants (Collision Bend, BrewDog, Noisy Oyster, Fishers Pub, Winking Lizard,
> Green Valley Brewing Co., …) get a recognizable icon and legend toggle.

Acceptance Criteria:
- [ ] A new `Food & Drink` icon type is added with its own map icon and legend entry.
- [ ] Its `title_keywords` are broad enough to classify the listed venues by name (brewing, brewery, pub, tavern, taproom, grill, eatery, restaurant, bar, oyster, lizard, …).
- [ ] Collision Bend Brewing Company and BrewDog Cleveland Outpost classify as Food & Drink.
- [ ] The type is selectable when creating/editing any POI, not just water-taxi stops.

**US-035-3: Navigate between a route and its stops**
> As a visitor, I want the Harbor Hopper route and its stops to be linked so that
> I can jump from the route to a stop and see which taxi serves a stop.

Acceptance Criteria:
- [ ] The Harbor Hopper sidebar lists its stops in route order, each clickable to open the stop POI.
- [ ] Each stop POI's sidebar shows that it is served by the Harbor Hopper (association), clickable back to the route.
- [ ] Clicking a stop marker on the map opens the stop POI sidebar.

### Defect Fix

**US-035-4: Upload a photo to a linear-feature POI**
> As a signed-in user, I want to add a photo to the Harbor Hopper (and any river
> or trail) so that the gallery is not silently broken for linear features.

Acceptance Criteria:
- [ ] On a linear-feature POI sidebar, clicking "+ Add Photo/Video" opens the upload modal.
- [ ] Uploading succeeds and the new media appears after moderation, same as for point POIs.
- [ ] The fix is marked with a `// Fix: <desc> (PR #N review)`-style inline note per the constitution.

---

## Data Model

### New Tables

None. Stops reuse the existing `pois` table (point POIs). The route↔stop
relationship is modeled via `pois.stops[].poi_id` plus a served-by lookup —
**not** `poi_associations` (see Open Questions).

### Schema Changes

```sql
-- Migration 0NN: water taxi stops as full POIs (#035)

-- 1. New reusable Food & Drink icon/POI type (broad name keywords).
INSERT INTO icons (name, label, svg_filename, title_keywords, activity_fallbacks, sort_order)
VALUES ('food_drink', 'Food & Drink', 'food_drink.svg',
        'brewing,brewery,brewpub,taproom,pub,tavern,bar,grill,kitchen,eatery,restaurant,diner,cafe,oyster,lizard,ale,distillery,winery',
        NULL, <sort_order>)
ON CONFLICT (name) DO NOTHING;

-- 2. Promote each Harbor Hopper stop to a full point POI (idempotent on name+point role).
--    Coordinates come from the existing Harbor Hopper pois.stops JSONB.

-- 3. Link the route's ordered stops to their POIs: extend each stops entry with poi_id
--    so the route can list stops in order and the map can suppress the duplicate circle.
--    (No poi_associations — the served-by direction is a stops @> poi_id lookup.)

-- 4. GIN index on pois.stops for the served-by lookup (stops @> {poi_id}).
```

- Stop POIs use `poi_roles = '{point}'`. The two breweries classify as `food_drink`
  by name; the two dock terminals (Main Hub, Flats East Bank) fall back to the
  default point marker (see Open Questions).
- `pois.stops` entries gain an optional `poi_id`: `[{name,lat,lng,poi_id}]`. When
  `poi_id` is set, the map renders the real POI marker instead of the decorative circle.
- The eLCee2 shuttle and its two docks are unchanged.

---

## API Endpoints

No new endpoints.

- Stop POIs are served by the existing `/api/pois`, `/api/pois/:id`, news/events,
  and media endpoints like any point POI.
- The existing associations endpoints surface the route↔stop relationship in both
  directions (route lists stops; stop shows serving route).
- The Food & Drink type flows to the frontend through the existing icon-config
  endpoint with no code change.

---

## UI/UX Requirements

### Map / Legend

- New **Food & Drink** legend toggle and map icon (grouped legend, spec 015).
- Harbor Hopper stops render as their POI markers; the decorative route circle is
  suppressed for any stop that now has a `poi_id`. eLCee2 circles are untouched.

### Sidebar

- **Harbor Hopper (route) sidebar:** lists its stops in route order, each clickable.
- **Stop POI sidebar:** standard point-POI sidebar (view/news/events/photos) plus a
  "Served by Harbor Hopper" association link.
- **Linear-feature photo upload (defect):** render the `MediaUploadModal` on the
  linear-feature sidebar branch so "+ Add Photo/Video" works for water taxis,
  rivers, and trails.

---

## Non-Functional Requirements

**NFR-035-1: Idempotent migration**
- Re-runs cleanly on every container start (guarded inserts, `ON CONFLICT DO NOTHING`,
  `WHERE NOT EXISTS`), per the project migration rules.

**NFR-035-2: No regressions for existing water taxis**
- eLCee2 and its docks, and the Harbor Hopper route line itself, render exactly as before.

**NFR-035-3: Collection eligibility**
- Food & Drink POIs are eligible for news/events collection (breweries host events);
  the type is NOT added to `news_collection_excluded_types`.

---

## Dependencies

- Depends on: water taxis (spec 023), amenity POI types / icon system (spec 027),
  grouped legend (spec 015), POI associations.
- Blocks: none.

---

## Open Questions

1. **Dock stop typing** — "Cleveland Water Taxi Main Hub" and "Flats East Bank" are
   transit docks, not food/drink. Default decision: they become point POIs with the
   default marker (no new dock icon this round). Revisit if a dedicated dock/ferry
   icon is wanted later.
2. ~~**Association modeling**~~ **RESOLVED:** Do **not** use `poi_associations`.
   The associations UI (`AssociationsTabContent.jsx`) is hardwired to the
   organization↔physical model (`isVirtualPoi = poi_roles.includes('organization')`,
   and it resolves the other side only from `allVirtualPois` = organizations), so a
   `water_taxi` route can be neither side and would mislabel the relationship. The
   route↔stop link is modeled by `pois.stops[].poi_id` (route→stop, already ordered)
   plus a small served-by lookup that finds `water_taxi` POIs whose `stops` contain a
   given `poi_id` (stop→route). Single source of truth, no org-system entanglement.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-06-13 | Initial draft |
</content>
</invoke>
