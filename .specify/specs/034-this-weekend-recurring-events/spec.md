# Specification: "This Weekend" View + Recurring Events & Overlay Organizations

> **Spec ID:** 034-this-weekend-recurring-events
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-06-07

## Overview

Adds a prominent **"This Weekend / Happening Now"** surface (GitHub #436, child of UX 1.0 #141)
that answers "what's going on right now?" without tab-diving. Underneath it adds the missing data
foundation: **recurring events** (rule-based series, not 50 materialized rows) and **overlay
organizations** — operators like the Cuyahoga Valley Farmers Market (CVFM) that run events *at* a
venue (Howe Meadow) without owning it. The weekend view is powered by projecting recurring series
plus one-off events into a near-term window with visible counts.

Concrete driving case: CVFM runs a **Summer Market** (weekly, Sundays, ~May–Oct) and a **Winter
Market** (biweekly, Saturdays, ~Nov–Apr) at Howe Meadow, plus occasional **special events**.

---

## User Stories

### Weekend Discovery (#436)

**US-034-1: See what's happening this weekend**
> As a Saturday-morning visitor, I want a prominent view of everything happening today/this weekend
> with a count, so that I can decide where to go without navigating tabs.

Acceptance Criteria:
- [ ] Events tab gains temporal subtabs: **Today | This Weekend | Future | Past**. Today and This
      Weekend each show one-off events + projected recurring occurrences in their window.
- [ ] **Default subtab** = Today when today has any events, else This Weekend (so weekend visitors
      land on "happening today" and quiet weekdays show the richer weekend view).
- [ ] A **count badge on the Events nav item** ("Events ·14") shows the "happening now" count
      (today's; weekend count when today is empty) without opening the tab — satisfying #436's
      "see the count without navigating."
- [ ] Rows show one-off events + recurring occurrences in the window (Today = the day; This Weekend =
      Fri evening → Sun).
- [ ] Each row shows title, time, venue, and the operating organization when applicable
      ("Farmers Market @ Howe Meadow · CVFM").
- [ ] Anonymous visitors get the full experience (no sign-in required).

### Recurring Events

**US-034-2: Model a recurring event once**
> As an admin, I want to define "Farmers Market, every Sunday, May–Oct, 9am–noon" as a single
> series, so that I don't hand-enter 50 rows and can edit the schedule in one place.

Acceptance Criteria:
- [ ] A series stores a recurrence rule (frequency, interval, weekday), an explicit **season begin
      and end date** entered by the admin, and start/end time of day.
- [ ] Occurrences are generated only within `[season_start, season_end]`; biweekly cadence anchors on
      the first matching weekday on/after `season_start`.
- [ ] The system projects a series into concrete upcoming occurrences for any requested date window.
- [ ] Editing the series (e.g., "now Saturdays") changes all future occurrences with one update.
- [ ] Recurring occurrences appear in the normal upcoming-events feed and the weekend view, not just
      a separate list.

**US-034-3: Browse recurring schedules**
> As a regular, I want to see what recurs and when ("Sundays — Farmers Market at Howe Meadow"),
> so that I can plan around weekly things.

Acceptance Criteria:
- [ ] Series are browsable with their cadence, venue, time, and next occurrence date.

### Overlay Organizations

**US-034-4: Run events at a venue without owning it**
> As an admin, I want to create CVFM as an organization that *operates at* Howe Meadow, so that the
> market's events surface on the Howe Meadow page while CVFM keeps its own identity and content.

Acceptance Criteria:
- [ ] An org can be linked to a venue with a relationship type of **"operates at" (`hosts_at`)**,
      distinct from **"owns / manages"**.
- [ ] On the **venue** page, events belonging to its overlay operators appear (reverse rollup).
- [ ] Reverse rollup fires **only** for `hosts_at` links — ownership/`manages` orgs are unaffected,
      so a child POI never inherits a parent system's entire event feed.
- [ ] CVFM's own page continues to show CVFM events (and, harmlessly, any venue events via the
      existing forward rollup).

### Special Events

**US-034-5: One-off market events**
> As an admin, I want CVFM special events to be ordinary one-off events on the CVFM POI, so that no
> new modeling is needed and they flow through existing display/collection.

Acceptance Criteria:
- [ ] Special events are normal `poi_events` rows on the CVFM POI and surface at Howe Meadow via
      reverse rollup like any CVFM event.

---

## Data Model

### New Tables

| Table | Description |
|-------|-------------|
| `poi_event_series` | Rule-based recurring event definitions (one row per recurring market/program). |

### Schema Changes

```sql
-- New: recurring event series (rule stored, occurrences expanded at read time)
CREATE TABLE IF NOT EXISTS poi_event_series (
  id              SERIAL PRIMARY KEY,
  poi_id          INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  title           VARCHAR(500) NOT NULL,
  description     TEXT,
  event_type      VARCHAR(100),
  location_details TEXT,
  source_url      TEXT,
  image_url       TEXT,
  -- Recurrence rule (RFC 5545 subset: weekly/biweekly/monthly by weekday)
  freq            VARCHAR(10) NOT NULL DEFAULT 'WEEKLY',  -- WEEKLY | MONTHLY
  interval        INTEGER NOT NULL DEFAULT 1,             -- 1 = every, 2 = biweekly
  byday           TEXT[] NOT NULL DEFAULT '{}',           -- e.g. {SU} or {SA}
  -- Explicit, admin-entered season bounds. Occurrences only within this range.
  -- Winter year-wrap is just an ordinary range (e.g. 2025-11-01 .. 2026-04-25).
  -- Biweekly anchors on the first `byday` match on/after season_start.
  season_start    DATE NOT NULL,
  season_end      DATE NOT NULL,
  -- Time of day
  time_start      TIME,
  time_end        TIME,
  -- Provenance / moderation (mirror poi_events conventions)
  content_source  VARCHAR(20) DEFAULT 'human',
  moderation_status VARCHAR(20) DEFAULT 'published',
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_poi_event_series_poi_id ON poi_event_series(poi_id);
CREATE INDEX IF NOT EXISTS idx_poi_event_series_active ON poi_event_series(active);

-- No schema change for overlay orgs: poi_associations.association_type already exists.
-- We introduce a new value 'hosts_at' alongside the default 'manages'.
```

CVFM data (migration 082, idempotent):
- Insert CVFM as a POI with `poi_roles = {organization}`, its own `news_url`/`events_url` →
  `cvfm.org`.
- Insert `poi_associations(virtual_poi_id=CVFM, physical_poi_id=Howe Meadow, association_type='hosts_at')`.
- Insert two `poi_event_series` rows (Summer Market, Winter Market) on the CVFM POI.

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/events/window?range=today\|weekend&tz=` | One-off + projected recurring occurrences in the requested window, with total count. Single endpoint serves both Today and This Weekend subtabs. | No |
| GET | `/api/events/recurring` | Active series (cadence, venue, next occurrence) — backs the `↻` rendering / "recurring only" filter. | No |
| GET | `/api/admin/event-series` | List series for admin. | Admin |
| POST | `/api/admin/event-series` | Create a series. | Admin |
| PUT | `/api/admin/event-series/:id` | Edit a series. | Admin |
| DELETE | `/api/admin/event-series/:id` | Delete a series. | Admin |

### Modified Behavior

- `getRollupPoiIds(poiId)` (geoService.js): add a **reverse-association** expansion — a physical POI
  also rolls up the orgs that `hosts_at` it. Gated strictly to `association_type='hosts_at'`.
- `GET /api/pois/:id/events`, `/api/events/upcoming`, tab-counts: include projected series
  occurrences for the rolled-up POI set within the requested window.

---

## UI/UX Requirements

### Components

- **Events tab subtab** — add "This Weekend" as the default subtab in `ParkEvents.jsx` alongside
  Future/Past. Reuses existing filters/pagination/card rendering. Recurring occurrences render inline
  with a `↻` cadence badge; an optional "recurring only" filter chip replaces the need for a separate
  recurring browse view.
- **Events nav badge** — count badge on the Events nav item ("Events ·14") sourced from the
  this-weekend count.
- Admin: `EventSeriesForm` — create/edit a series; org association includes the relationship-type
  selector (**Owns/manages** vs **Operates at venue**).

### Wireframes

```
 Nav:  Map   News   Events ·14   About
                     └─ [ This Weekend ] Future  Past
── This Weekend ──────────────────────────  [ 14 events ]
 SUN  9:00a  Farmers Market        Howe Meadow · CVFM   ↻ weekly
 SAT 10:00a  Guided Ledges Hike    The Ledges
 SAT  2:00p  Bird Walk             Beaver Marsh
 ...
```

---

## Non-Functional Requirements

**NFR-034-1: Local-First (constitution)**
- The weekend view and series browsing work fully for anonymous visitors. No new user-data storage
  is introduced here; if "follow this series" is added later it MUST use `createPoiIdListStore` /
  `syncPoiIdList` per `docs/USER_DATA_FRAMEWORK.md`.

**NFR-034-2: Performance**
- Series projection happens at read time over a small set (active series for the rolled-up POIs).
  Expansion is bounded to the requested window; no unbounded loops.

**NFR-034-3: Timezone correctness**
- Weekend window and occurrence dates computed in the venue/America-New_York timezone, consistent
  with existing `tz`-aware event endpoints (migration 043 fixed prior tz issues — do not regress).

**NFR-034-4: Safety of reverse rollup**
- Reverse rollup is restricted to `hosts_at`; ownership orgs (Cleveland Metroparks, Summit Metro
  Parks, Conservancy) must show no behavioral change.

---

## Dependencies

- Depends on: existing org/`poi_associations` machinery (`005-poi-roles`, `026-geofenced-news`),
  events schema, `getRollupPoiIds`.
- Implements: GitHub #436 (child of #141).

---

## Open Questions

1. Recurrence library vs hand-rolled: rrule.js (RFC 5545, robust) vs a small in-repo weekly/biweekly/
   monthly-by-weekday expander (no dependency, covers all known cases). **Leaning hand-rolled for v1**
   to avoid a dependency for a narrow rule set — revisit if rules get exotic.
2. "This Weekend" window definition: Fri 5pm → Sun 11:59pm by default? And does "Happening Today"
   need to be a distinct quick-filter within the same surface?
3. Exact CVFM season boundaries, market times, and the winter biweekly anchor date — pull from
   cvfm.org during data seeding (migration 082).
4. ~~Dedicated nav tab vs banner~~ **RESOLVED:** This Weekend is the default subtab of Events + a
   count badge on the Events nav item. Map banner deferred as a fast-follow.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-06-07 | Initial draft |
