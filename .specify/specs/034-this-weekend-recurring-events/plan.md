# Implementation Plan: "This Weekend" + Recurring Events & Overlay Orgs

> **Spec ID:** 034-this-weekend-recurring-events
> **Status:** Planning
> **Last Updated:** 2026-06-07
> **Estimated Effort:** L

## Summary

Add a `poi_event_series` table (the recurrence rule / source of truth) and a generator that
**materializes** each series' occurrences as real `poi_events` rows, give events/series a
`venue_poi_id` (organizer vs venue) so venue pages surface events held there, and ship a first-class
"This Weekend" surface (#436). Seed CVFM as the organizer of two recurring markets at Howe Meadow and
Old Trail School.

---

## Architecture

### Generate (write) → query (read)

1. **Generate:** `materializeSeries(series)` expands the rule over `[season_start, season_end]`
   (respecting `byday`/`interval`/`exdates`, biweekly anchored on the first `byday` on/after
   `season_start`) and upserts the occurrences into `poi_events` (linked by `series_id`, with a
   denormalized `recurrence_label`). FUTURE rows are regenerated on each run; PAST rows are kept.
   Runs on series create/update/delete and on backend boot (`materializeAllSeries`). Idempotent via
   the `(series_id, start_date)` unique index.
2. **Read:** every events surface just queries `poi_events` — Today/This Weekend window, Future, Past,
   newsletter, notifications, search, permalinks — no read-time expansion. Card-facing endpoints also
   select `series_id`, `recurrence_label` (as `cadence_label`), and `venue_name`.
3. **Timezone:** timed occurrences stored via `($local::timestamp AT TIME ZONE $tz)`; date-only as UTC
   midnight, so they render correctly in local time.

### Organizer vs venue

Events and series carry `poi_id` (organizer) and `venue_poi_id` (where). Event/series queries match
`poi_id = ANY(ids) OR venue_poi_id = ANY(ids)`, so a venue's page surfaces events held there with no
org-level bleed. `getRollupPoiIds` is unchanged — venue is a per-event link, not a POI association.
(An earlier draft used a `hosts_at` reverse rollup; the venue column supersedes it and is precise.)

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Recurrence + generation | Hand-rolled expander + `materializeSeries` in `backend/services/eventSeriesService.js` | Narrow rule set (weekly/biweekly by weekday + season + exdates); no rrule.js dependency. |
| Surfacing | Materialize occurrences into `poi_events` | Makes recurring events appear everywhere regular events do (newsletter/notifications/past/search) with zero per-consumer code; bounded by season so finite. |
| tz storage | `($local::timestamp AT TIME ZONE $tz)` on insert | Stores the correct instant; renders in local time without regressing migration 043. |

---

## Implementation Steps

### Phase 1: Backend foundation
- [ ] Migration `081_poi_event_series.sql` — series table + `venue_poi_id`; `ALTER poi_events ADD
      venue_poi_id, series_id, recurrence_label` + unique `(series_id, start_date)`; widen
      `chk_events_content_source` to allow `recurring`. Idempotent.
- [ ] `backend/services/eventSeriesService.js` — `expandSeries`, `cadenceLabel`, `materializeSeries`
      (tz-correct upsert; future regenerated, past kept), `materializeAllSeries`.

### Phase 2: API
- [ ] `GET /api/events/window?range=today|weekend` — events in the window (materialized recurring
      included), tz-aware, with count.
- [ ] `GET /api/events/recurring` — active series + next occurrence (series management/browse).
- [ ] Event endpoints (`/api/pois/:id/events`, `/api/events/upcoming|past`, tab-counts) select
      `series_id` / `recurrence_label` / `venue_name`; venue matching `poi_id OR venue_poi_id`.
- [ ] Admin CRUD `GET/POST/PUT/DELETE /api/admin/event-series`; create/update call `materializeSeries`,
      delete removes future occurrences (keeps past). Boot calls `materializeAllSeries`.

### Phase 3: Frontend
- [ ] `ParkEvents.jsx` — Today/This Weekend subtabs (default Today, else This Weekend), no counts.
- [ ] `NewsEventsShared.jsx` `EventCardBody` — cadence line ("Weekly: Saturdays") + green venue link
      on the Location line.
- [ ] `ContentFormModal.jsx` — "Repeats" dropdown that swaps one-off date fields for recurrence +
      season + times + venue + skip-dates; create (POST) and edit (PUT) a series.
- [ ] `ParkEvents.jsx` — Edit/Delete controls on recurring (series-linked) occurrence cards.

### Phase 4: Data
- [ ] Migration `082_cvfm_overlay_org.sql` — CVFM org POI + Old Trail School POI; two series
      (`poi_id`=CVFM, `venue_poi_id`=Howe Meadow / Old Trail School), weekly Saturdays, seasons/times/
      exdates from cvfm.org.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/081_poi_event_series.sql` | Series table + poi_events `venue_poi_id`/`series_id`/`recurrence_label` + unique index + CHECK widening |
| `backend/migrations/082_cvfm_overlay_org.sql` | CVFM org + Old Trail School POI + two series (with venue) |
| `backend/services/eventSeriesService.js` | Expander, cadence label, `materializeSeries`/`materializeAllSeries` |
| `backend/tests/eventSeries.unit.test.js` | Expander unit tests (cadence, biweekly, season bounds, exdates, venue) |

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | window/recurring endpoints; venue matching + venue join + series fields on event queries; boot `materializeAllSeries` |
| `backend/routes/admin.js` | event-series CRUD + materialize hooks; `venue_poi_id` on series and one-off events |
| `frontend/src/components/ParkEvents.jsx` | Today/This Weekend subtabs; series Edit/Delete controls; reload after CRUD |
| `frontend/src/components/NewsEventsShared.jsx` | cadence line + green venue link on event card |
| `frontend/src/components/ContentFormModal.jsx` | "Repeats" dropdown → series create/edit form |
| `frontend/src/App.css` | recurrence/venue/series-control styles |

---

## Database Migrations

See spec Data Model for `081_poi_event_series.sql`. `082` is data-only and idempotent
(`INSERT ... WHERE NOT EXISTS` / `ON CONFLICT DO NOTHING`), looking CVFM and Howe Meadow up by name.

Per project convention: migrations are idempotent and re-run every deploy; **prod migrations are run
manually on deploy** (`reference_prod_migrations_manual`).

---

## Testing Strategy

### Unit
- [ ] `expandSeries`: weekly Sundays within `[season_start, season_end]`; biweekly anchor (first
      Saturday on/after `season_start`, then every 2 weeks); year-wrap winter range (Nov→Apr);
      no occurrences outside the season bounds; window/season intersection.

### Integration / manual (verified)
- [x] Boot materialization: 52 occurrences across 2 series on a clean container (27 summer, 25 winter
      after 3 exdates).
- [x] Venue precision: Howe Meadow → summer only; Old Trail School → winter only; CVFM organizer →
      both (no cross-bleed).
- [x] Surfaces everywhere: past market Saturdays appear in `/api/events/past`; weekend window shows
      the Saturday market; tz correct (9am ET stored as 13:00Z).
- [ ] Edit a series (day/season) → future occurrences regenerate, past kept (browser check).

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Venue link surfaces wrong events on a POI page | Med | Venue is an explicit per-event `venue_poi_id`; verified no cross-bleed (Howe Meadow=summer only, Old Trail School=winter only). |
| Timezone drift in weekend window / occurrence dates | Med | Compute in venue tz consistent with existing endpoints; unit-test boundaries; don't regress migration 043. |
| `reload-app` skips `backend/services|migrations` | Med | Use full `./run.sh build` before verification (known gotcha). |
| Multi-source CVFM pages (summer/winter/special) | Low | Series are authored manually; only special-event *collection* is single-URL — out of scope for v1, flag as follow-up. |

---

## Rollback Plan

1. Frontend subtabs are additive — they reuse the Events tab; no nav change to revert.
2. To remove recurring events, deactivate the series (`active=false`) and delete their materialized
   rows: `DELETE FROM poi_events WHERE series_id IS NOT NULL`. One-off events are untouched.
3. `venue_poi_id` / `series_id` / `recurrence_label` are nullable, additive columns; ordinary events
   have them NULL, so dropping the feature has no effect on existing data.

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-06-07 | Initial plan |
