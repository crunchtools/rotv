# Implementation Plan: "This Weekend" + Recurring Events & Overlay Orgs

> **Spec ID:** 034-this-weekend-recurring-events
> **Status:** Planning
> **Last Updated:** 2026-06-07
> **Estimated Effort:** L

## Summary

Add a `poi_event_series` table with a small read-time expander, extend `getRollupPoiIds` with a
`hosts_at`-gated reverse expansion, project series occurrences into the upcoming/weekend feeds, and
ship a first-class "This Weekend" surface (#436). Seed CVFM as an overlay org at Howe Meadow with two
recurring series.

---

## Architecture

### Data Flow (weekend view)

1. Client requests `GET /api/events/window?range=weekend&tz=America/New_York` (or `range=today`).
2. Backend computes the window in `tz` — weekend = [Fri 17:00 → Sun 23:59], today = [00:00 → 23:59].
3. Query one-off `poi_events` (published/auto_approved) with `start_date` in window.
4. Load active `poi_event_series`; the expander projects each into concrete occurrences in the
   intersection of the request window and `[season_start, season_end]` (respecting `byday` and
   `interval`, biweekly anchored on the first `byday` on/after `season_start`).
5. Merge + sort one-offs and projected occurrences; attach venue + operating-org labels via the
   POI/association data; return list + count.

### Reverse rollup

`getRollupPoiIds(poiId)` gains one query: for a physical POI, `SELECT virtual_poi_id FROM
poi_associations WHERE physical_poi_id = $1 AND association_type = 'hosts_at'`. Those org ids (and
their own events) join the rolled-up set. Forward behavior for `manages`/`owner_id` is untouched.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Recurrence expansion | Hand-rolled expander in `backend/services/eventSeriesService.js` | Rule set is narrow (weekly/biweekly/monthly by weekday + seasonal windows); avoids an rrule.js dependency. Revisit if rules get exotic. |
| Date math / tz | Existing project tz approach (chrono-node already present; native Date in `tz`) | Stay consistent with current `tz`-aware endpoints; don't regress migration 043 tz fixes. |
| Series storage | New `poi_event_series` table | Rule-based, one row per series; clean edits, no row explosion. |

---

## Implementation Steps

### Phase 1: Backend foundation
- [ ] Migration `081_poi_event_series.sql` — create table + indexes (idempotent).
- [ ] `backend/services/eventSeriesService.js` — `expandSeries(series, fromDate, toDate, tz)` →
      occurrences; `getActiveSeriesForPois(pool, poiIds)`.
- [ ] Extend `getRollupPoiIds` with `hosts_at` reverse expansion (+ inline `// Fix:`-style note and
      a guard so ownership orgs are unaffected).

### Phase 2: API
- [ ] `GET /api/events/window?range=today|weekend` (one-offs + projected occurrences + count,
      tz-aware; single endpoint backs both Today and This Weekend subtabs).
- [ ] `GET /api/events/recurring` (active series + next occurrence).
- [ ] Project series into existing `GET /api/pois/:id/events`, `/api/events/upcoming`, and tab-counts
      for the rolled-up POI set.
- [ ] Admin CRUD: `GET/POST/PUT/DELETE /api/admin/event-series`.

### Phase 3: Frontend
- [ ] Add "This Weekend" as the **default subtab** in `ParkEvents.jsx` (This Weekend | Future | Past),
      wired to `/api/events/this-weekend`; reuse existing filters/pagination.
- [ ] Count badge on the Events nav item in `App.jsx` (sourced from the this-weekend count).
- [ ] Recurring occurrence rendering in `ParkEvents.jsx` / `NewsEventsShared.jsx` (a `↻` cadence
      badge; reuse `EventCardBody`) + optional "recurring only" filter chip.
- [ ] Admin `EventSeriesForm` + relationship-type selector on org association
      (Owns/manages vs Operates at venue).

### Phase 4: Data
- [ ] Migration `082_cvfm_overlay_org.sql` — CVFM org POI, `hosts_at` association to Howe Meadow,
      two series (Summer weekly Sun, Winter biweekly Sat), seasons/times from cvfm.org.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/081_poi_event_series.sql` | Series table + indexes |
| `backend/migrations/082_cvfm_overlay_org.sql` | CVFM org + association + seed series |
| `backend/services/eventSeriesService.js` | Series expander + queries |
| `frontend/src/components/admin/EventSeriesForm.jsx` | Admin series CRUD form |

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/geoService.js` | `hosts_at` reverse rollup in `getRollupPoiIds` |
| `backend/server.js` | this-weekend + recurring endpoints; series projection into events/tab-counts |
| `backend/routes/admin.js` | event-series CRUD |
| `frontend/src/App.jsx` | Events nav count badge |
| `frontend/src/components/ParkEvents.jsx` / `NewsEventsShared.jsx` | This Weekend default subtab + render recurring occurrences + cadence badge |
| `frontend/src/components/admin/*` (association editor) | relationship-type selector |

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

### Integration
- [ ] Reverse rollup: Howe Meadow events include CVFM events; an ownership org (Metroparks) child POI
      does **not** inherit parent events (guardrail).
- [ ] `/api/events/this-weekend`: count + merged one-offs and occurrences for a fixed tz/date.

### Manual
1. Open This Weekend → count + Sunday market visible.
2. Open Howe Meadow POI → Farmers Market shows (reverse rollup), labeled CVFM.
3. Edit Summer Market series day Sun→Sat → future occurrences shift.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Reverse rollup leaks parent feeds onto child pages | High | Gate strictly to `association_type='hosts_at'`; integration test asserts ownership orgs unchanged. |
| Timezone drift in weekend window / occurrence dates | Med | Compute in venue tz consistent with existing endpoints; unit-test boundaries; don't regress migration 043. |
| `reload-app` skips `backend/services|migrations` | Med | Use full `./run.sh build` before verification (known gotcha). |
| Multi-source CVFM pages (summer/winter/special) | Low | Series are authored manually; only special-event *collection* is single-URL — out of scope for v1, flag as follow-up. |

---

## Rollback Plan

1. Frontend tab is additive — hide the nav entry to disable the surface.
2. `poi_event_series` is independent; series projection is read-time — stop projecting and one-offs
   remain.
3. Reverse rollup is gated to `hosts_at`; removing CVFM's association (or the gate) fully reverts
   venue behavior.

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-06-07 | Initial plan |
