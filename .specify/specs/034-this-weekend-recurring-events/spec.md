# Specification: "This Weekend" View + Recurring Events & Overlay Organizations

> **Spec ID:** 034-this-weekend-recurring-events
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-06-07

## Overview

Adds a prominent **"This Weekend / Happening Now"** surface (GitHub #436, child of UX 1.0 #141)
that answers "what's going on right now?" without tab-diving. Underneath it adds the missing data
foundation: **recurring events** and **organizer-vs-venue** modeling — operators like the Cuyahoga
Valley Farmers Market (CVFM) that run events *at* a venue (Howe Meadow / Old Trail School) without
owning it.

Recurring events are stored as a **rule** (`poi_event_series`, the editable source of truth) and the
generator **materializes** each rule's occurrences as real `poi_events` rows. That way recurring
events appear **everywhere regular events do** — Today/This Weekend, Future, Past, the newsletter,
notifications, search, and permalinks — with no per-consumer projection code.

Concrete driving case (per cvfm.org): CVFM runs a **Summer Market** (weekly Saturdays, May–Oct, at
Howe Meadow) and a **Winter Market** (weekly Saturdays, Nov–Apr, at Old Trail School, with holiday
closures), plus occasional **special events**.

---

## User Stories

### Weekend Discovery (#436)

**US-034-1: See what's happening this weekend**
> As a Saturday-morning visitor, I want a prominent view of everything happening today/this weekend
> with a count, so that I can decide where to go without navigating tabs.

Acceptance Criteria:
- [ ] Events tab gains temporal subtabs: **Today | This Weekend | Future | Past**. Today and This
      Weekend each show one-off events + recurring occurrences in their window.
- [ ] **Default subtab** = Today when today has any events, else This Weekend (so weekend visitors
      land on "happening today" and quiet weekdays show the richer weekend view). This is what makes
      the surface reachable for #436 — a Saturday visitor lands directly on today's events.
- [ ] Rows show one-off events + recurring occurrences in the window (Today = the day; This Weekend =
      Fri evening → Sun). No numeric count is shown in subtab titles or as a nav badge (kept clean per
      product direction).
- [ ] Each row shows title, time, venue, and the operating organization when applicable
      ("Farmers Market @ Howe Meadow · CVFM").
- [ ] Anonymous visitors get the full experience (no sign-in required).

### Recurring Events

**US-034-2: Model a recurring event once**
> As an admin, I want to define "Farmers Market, every Sunday, May–Oct, 9am–noon" as a single
> series, so that I don't hand-enter 50 rows and can edit the schedule in one place.

Acceptance Criteria:
- [ ] A series stores a recurrence rule (frequency, interval, weekday), an explicit **season begin
      and end date** entered by the admin, start/end time of day, and exception dates.
- [ ] The generator materializes occurrences into `poi_events` only within `[season_start,
      season_end]`, skipping exception dates; biweekly cadence anchors on the first matching weekday
      on/after `season_start`. Runs on series create/edit/delete and on backend boot (idempotent).
- [ ] Editing the series (e.g., "now Saturdays") regenerates all **future** occurrences with one
      update; **past** occurrences are kept as historical record.
- [ ] Because occurrences are real `poi_events`, recurring events appear in **every** events surface —
      Today/This Weekend, Future, Past, newsletter, notifications, search, permalinks — automatically.

**US-034-3: Browse recurring schedules**
> As a regular, I want to see what recurs and when ("Sundays — Farmers Market at Howe Meadow"),
> so that I can plan around weekly things.

Acceptance Criteria:
- [ ] Series are browsable with their cadence, venue, time, and next occurrence date.

### Organizer vs Venue (overlay organizations)

**US-034-4: Run events at a venue without owning it**
> As an admin, I want to set an event's **venue** separately from the **organizer** POI, so that an
> operator like CVFM can run markets at venues it doesn't own, and each venue surfaces exactly the
> events held there.

Acceptance Criteria:
- [ ] Events and series carry both `poi_id` (organizer / who runs it) and `venue_poi_id` (where it
      physically happens). `venue_poi_id` is optional.
- [ ] A POI's events = those where `poi_id` **or** `venue_poi_id` matches the rolled-up id set, so a
      **venue** page surfaces events held there and an **organizer** page surfaces what it runs.
- [ ] No cross-bleed: a venue shows only the events whose `venue_poi_id` is that venue — e.g. Howe
      Meadow shows the summer market only, Old Trail School the winter market only, while the CVFM
      organizer page shows both.
- [ ] Ownership orgs and the generic boundary/org rollup are unchanged (this is a per-event link, not
      a POI-to-POI association).

### Special Events

**US-034-5: One-off market events**
> As an admin, I want CVFM special events to be ordinary one-off events on the CVFM POI, so that no
> new modeling is needed and they flow through existing display/collection.

Acceptance Criteria:
- [ ] Special events are normal `poi_events` rows organized by CVFM (`poi_id`), optionally with a
      `venue_poi_id` so they surface at that venue like any venue-tagged event.

---

## Data Model

### New Tables

| Table | Description |
|-------|-------------|
| `poi_event_series` | Rule-based recurring event definitions (one row per recurring market/program). |

### Schema Changes

```sql
-- New: recurring event series (the rule / source of truth; occurrences materialized into poi_events)
CREATE TABLE IF NOT EXISTS poi_event_series (
  id              SERIAL PRIMARY KEY,
  poi_id          INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,  -- organizer
  venue_poi_id    INTEGER REFERENCES pois(id) ON DELETE SET NULL,          -- where it's held
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
  -- Exception dates (EXDATE): in-season dates the event is skipped (holiday closures).
  exdates         DATE[] NOT NULL DEFAULT '{}',
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

-- One-off events get the same organizer/venue split (nullable; existing events keep their
-- free-text location_details):
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS venue_poi_id INTEGER REFERENCES pois(id) ON DELETE SET NULL;

-- Materialized recurring occurrences live in poi_events, linked back to their rule. series_id
-- (ON DELETE SET NULL → past rows survive as standalone history) + recurrence_label (denormalized
-- cadence, "Weekly: Saturdays"). Unique (series_id, start_date) keeps the generator idempotent.
-- content_source 'recurring' is added to the chk_events_content_source CHECK.
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS series_id INTEGER REFERENCES poi_event_series(id) ON DELETE SET NULL;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS recurrence_label TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_poi_events_series_start ON poi_events (series_id, start_date);
```

CVFM data (migration 082, idempotent) — actuals confirmed from cvfm.org:
- Insert CVFM as a POI with `poi_roles = {organization}` (the organizer), `more_info_link → cvfm.org`.
- Insert **Old Trail School** as a `point` POI (the winter venue; Howe Meadow already exists in prod
  as POI 6370).
- Insert two `poi_event_series` with `poi_id = CVFM` and `venue_poi_id` set to the venue, both
  **weekly Saturdays, 9am–12pm**:
  - Summer Market — May 2 → Oct 31, 2026, `venue_poi_id = Howe Meadow`.
  - Winter Market — Nov 7, 2026 → Apr 24, 2027, `venue_poi_id = Old Trail School`, with `exdates`
    `{2026-11-28, 2026-12-26, 2027-01-02}` (holiday closures).

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/events/window?range=today\|weekend&tz=` | All events (one-off + materialized recurring) in the requested window, with total count. Single endpoint serves both Today and This Weekend subtabs. | No |
| GET | `/api/events/recurring` | Active series (cadence, venue, next occurrence) — backs the `↻` rendering / "recurring only" filter. | No |
| GET | `/api/admin/event-series` | List series for admin. | Admin |
| POST | `/api/admin/event-series` | Create a series. | Admin |
| PUT | `/api/admin/event-series/:id` | Edit a series. | Admin |
| DELETE | `/api/admin/event-series/:id` | Delete a series. | Admin |

### Modified Behavior

- Event queries (`GET /api/pois/:id/events`, tab-counts) match `poi_id = ANY(ids) OR venue_poi_id =
  ANY(ids)` so a venue surfaces events held there. The generic `getRollupPoiIds` is unchanged — venue
  is a per-event link, not a POI association.
- No read-time projection: because occurrences are materialized `poi_events`, the event endpoints
  just query `poi_events` and join the venue. They select `series_id`, `recurrence_label` (as
  `cadence_label`), and `venue_name` so the card renders the cadence line + venue link.
- `materializeAllSeries` runs on backend boot (idempotent); `materializeSeries` runs on series
  create/update/delete via the admin API.

---

## UI/UX Requirements

### Components

- **Events tab subtabs** — add "Today" and "This Weekend" subtabs in `ParkEvents.jsx` alongside
  Future/Past, defaulting to Today (or This Weekend when today is empty). Reuses existing
  filters/pagination/card rendering. Recurring occurrences render inline with a `↻` cadence badge and
  a `📍` venue line. No numeric counts in titles or nav.
- Admin: a **"Recurring event" toggle** in the Events "+ New" form (`ContentFormModal`) swaps the
  one-off date fields for recurrence + season + times + venue + skip-dates, posting to
  `/api/admin/event-series`.

### Wireframes

```
 Nav:  Map   News   Events   About
              └─ [ Today ]  This Weekend  Future  Past
── Events ─────────────────────────────────
 SAT  9:00a  Farmers Market — Summer    📍 Howe Meadow    ↻ Weekly · Saturdays
 SAT 10:00a  Guided Ledges Hike         📍 The Ledges
 SAT  2:00p  Bird Walk                  📍 Beaver Marsh
 ...
```

---

## Non-Functional Requirements

**NFR-034-1: Local-First (constitution)**
- The weekend view and series browsing work fully for anonymous visitors. No new user-data storage
  is introduced here; if "follow this series" is added later it MUST use `createPoiIdListStore` /
  `syncPoiIdList` per `docs/USER_DATA_FRAMEWORK.md`.

**NFR-034-2: Performance**
- Generation is bounded by each series' season (≈26 rows/market), so materialized rows are finite and
  small; read endpoints query `poi_events` with the existing indexes — no read-time expansion.

**NFR-034-3: Timezone correctness**
- Occurrence instants are stored tz-correctly (timed occurrences as the venue/America-New_York
  instant via `AT TIME ZONE`, date-only as UTC midnight) so they render in local time; the weekend
  window is computed in `tz`. Do not regress the migration 043 tz fixes.

**NFR-034-4: Venue precision (no cross-bleed)**
- A venue surfaces only events whose `venue_poi_id` is that venue; the organizer page shows what it
  runs. Ownership orgs and the generic boundary/org rollup show no behavioral change.

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
3. ~~Exact CVFM schedule~~ **RESOLVED** from cvfm.org: both markets weekly Saturdays 9am–12pm;
   summer @ Howe Meadow (May 2–Oct 31 2026), winter @ Old Trail School (Nov 7 2026–Apr 24 2027) with
   three holiday-closure `exdates`. Added `exdates` (EXDATE) to the model to support the closures.
4. ~~Dedicated nav tab vs banner~~ **RESOLVED:** This Weekend is the default subtab of Events + a
   count badge on the Events nav item. Map banner deferred as a fast-follow.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-06-07 | Initial draft |
