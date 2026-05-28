# Specification: OSM-Sourced Visitor Info (Hours, Accessibility, Fee)

> **Spec ID:** 029-osm-visitor-info
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-27

## Overview

Issue #7 asks for cost, hours, and mobility fields on POIs for One Tank Trip
planning. This adds three new POI fields — **operating hours**, **wheelchair
accessibility**, and **fee (yes/no)** — surfaced in the Side Panel's *Visitor
Information* section. The three map directly to standard OpenStreetMap tags
(`opening_hours`, `wheelchair`, `fee`), so the OSM amenity import pipeline is
extended to pre-populate them for the ~240 OSM-sourced amenity POIs, while all
POIs remain editable by admins. Cost is captured as a yes/no fee flag, not a
dollar amount — OSM rarely tags `charge` and pricing goes stale (see issue note
"need to plan that").

---

## User Stories

### Visitor Planning

**US-028-1: See operating hours**
> As a visitor planning a trip, I want to see a POI's operating hours so that I
> can avoid arriving when it is closed.

Acceptance Criteria:
- [ ] When a POI has `opening_hours`, the Visitor Information section shows an "Hours" row.
- [ ] The row is hidden when the value is null/empty (no empty rows).

**US-028-2: See accessibility**
> As a visitor with mobility needs, I want to see wheelchair accessibility so
> that I can decide whether a destination works for me.

Acceptance Criteria:
- [ ] `wheelchair` value renders as a human label (Accessible / Limited / Not accessible / Designated).
- [ ] Row hidden when unset.

**US-028-3: See whether there is a fee**
> As a visitor, I want to know whether a POI charges a fee so that I can budget.

Acceptance Criteria:
- [ ] `fee` renders as Yes / No / Varies.
- [ ] Row hidden when unset.

### Content Curation

**US-028-4: Edit the fields**
> As an admin, I want to edit hours, accessibility, and fee on any POI so that I
> can correct or supplement OSM data.

Acceptance Criteria:
- [ ] EditView exposes inputs for all three fields (text for hours, selects for accessibility/fee).
- [ ] Values persist via the existing admin POI update endpoints.

### OSM Enrichment

**US-028-5: Auto-populate amenities from OSM**
> As a maintainer, I want the OSM amenity import to capture these tags so that
> the seeded amenities ship with hours/accessibility/fee where OSM has them.

Acceptance Criteria:
- [ ] `amenities.json` snapshot includes `opening_hours`, `wheelchair`, `fee` when present in OSM.
- [ ] `import-osm-amenities.js` writes them on insert and refreshes them on re-import, without clobbering a non-null OSM value with null.
- [ ] Idempotent: re-running does not duplicate or wipe data.

**US-028-6: Match curated POIs to OSM**
> As a maintainer, I want ROTV's hand-curated POIs (parks, trails, visitor
> centers, businesses) matched to their OpenStreetMap features so that they
> record an `osm_id` and gain hours/accessibility/fee where OSM has them.

Acceptance Criteria:
- [ ] Matching is name-gated (token similarity) with proximity scaled to name
      confidence — proximity alone never matches (no shoe-store-inherits-cafe-hours).
- [ ] Matches are written to a committed, reviewable `poi-osm-matches.json`.
- [ ] Apply is idempotent and non-destructive: `osm_id` set once per name on an
      unlinked row only if the id is free; visitor-info fields use COALESCE;
      `more_info_link` is never touched (curated official links survive).
- [ ] Of ~465 curated POIs, ~248 match at high precision; the ~18 OSM tags are
      surfaced. (Most CVNP-area features simply aren't tagged with these fields
      in OSM — the ceiling is OSM coverage, not matching.)

---

## Data Model

### Schema Changes

```sql
-- Migration 067: OSM visitor-info fields (issue #7)
ALTER TABLE pois ADD COLUMN IF NOT EXISTS opening_hours TEXT;          -- raw OSM opening_hours string
ALTER TABLE pois ADD COLUMN IF NOT EXISTS wheelchair    VARCHAR(12);   -- yes | limited | no | designated
ALTER TABLE pois ADD COLUMN IF NOT EXISTS fee           VARCHAR(12);   -- yes | no | conditional

ALTER TABLE pois ADD CONSTRAINT pois_wheelchair_check
  CHECK (wheelchair IS NULL OR wheelchair IN ('yes','limited','no','designated'));
ALTER TABLE pois ADD CONSTRAINT pois_fee_check
  CHECK (fee IS NULL OR fee IN ('yes','no','conditional'));
```

Column names mirror the OSM tag keys so provenance is obvious. Constraints are
added defensively (drop-if-exists first for idempotent re-run).

---

## API Endpoints

No new endpoints. The three fields are added to the `allowedFields` allowlists
in the existing POI create/update handlers in `backend/routes/admin.js` (4 sites:
point update, linear update, point insert, virtual/linear insert) and returned
by the existing POI read endpoints.

---

## UI/UX Requirements

### Changed Components

- `ReadOnlyView.jsx` — add Hours / Accessibility / Fee rows to the existing
  *Visitor Information* `details-grid`, each conditionally rendered.
- `EditView.jsx` — add a text input (Hours) and two selects (Accessibility, Fee)
  alongside Surface / Pets / Cell Signal.

### Display mapping

| Field | Stored | Displayed |
|-------|--------|-----------|
| Hours | raw `opening_hours` | verbatim (e.g. `Mo-Su 06:00-22:00`) |
| Accessibility | `yes`/`limited`/`no`/`designated` | Accessible / Limited / Not accessible / Designated |
| Fee | `yes`/`no`/`conditional` | Yes / No / Varies |

---

## Non-Functional Requirements

**NFR-028-1: Idempotency** — migration and OSM import re-run safely on every deploy.

**NFR-028-2: No clobber** — OSM re-import never overwrites a present value with null.

**NFR-028-3: Sparse data is normal** — every field is optional; rows hide when unset.

---

## Dependencies

- Builds on spec 027 (amenity POI types) — reuses `pois.osm_id`, `amenities.json`,
  and `import-osm-amenities.js`.

---

## Open Questions

1. Should hours be humanized (parse `opening_hours` syntax) or shown verbatim?
   Decision: verbatim for v1; humanization is a future enhancement.
2. Should non-OSM curated POIs (parks, trails, businesses) be matched to OSM for
   auto-fill? Decision: out of scope for v1 — those are admin-entered.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-27 | Initial draft |
