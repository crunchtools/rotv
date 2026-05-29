# Specification: Three-Gate Auto-Moderation

> **Spec ID:** 030-moderation-gates
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-29

## Overview

The monthly collection run dumps hundreds of unscored items into the moderation
queue (610 pending news items as of this writing, all with `confidence_score = null`).
The existing auto-moderation logic collapses several distinct judgments into one
opaque decision, never auto-rejects borderline content, and surfaces almost nothing
to the admin about *why* an item is pending.

This feature restructures auto-moderation around the **three independent judgments
Scott actually makes by hand** when reviewing an item — **Date**, **Relevance**, and
**POI correctness** — and auto-publishes only when all three pass. Each gate's verdict
and reasoning is stored and shown in the admin UI, so a pending item tells you exactly
which gate needs a human. The sweep that scores the backlog is made fast enough to
clear a monthly dump.

---

## User Stories

### Auto-moderation

**US-001: Three-gate auto-publish**
> As the site admin, I want items auto-published only when the date, relevance, AND
> POI assignment all pass, so that I only hand-review the items where one of those
> three judgments is uncertain.

Acceptance Criteria:
- [ ] An item is `auto_approved` only when all three gates return `pass`.
- [ ] An item is `rejected` only on a hard-fail (existing: duplicate, no source URL, deny list) or a unanimous-NO relevance vote.
- [ ] Every other item is `pending` with each gate's verdict recorded.
- [ ] No item is ever rejected for being *old* — age is never a negative signal (historical content is valuable).

**US-002: Date gate**
> As the admin, I want a date to count as trustworthy when it is plausible and comes
> from a source I trust, so that good dates from sources like cleveland.com / akron.com /
> the trusted-domain list auto-pass without me checking each one.

Acceptance Criteria:
- [ ] Date gate `pass` requires: a publication date present, not in the future, with a plausible year (≥ floor, default 2010), AND (date-consensus score ≥ threshold **OR** the source domain is on `moderation_trusted_domains`).
- [ ] A hallucinated date (year below the floor, e.g. an 1800s value) yields `review`, not `pass`.
- [ ] A missing date, or a low-consensus date from an untrusted domain, yields `review`.
- [ ] Old-but-trusted dates still pass (no recency ceiling).

**US-003: Relevance gate (with visibility)**
> As the admin, I want to see how the LLM relevance vote actually went, so that I trust
> (or correct) the relevance judgment instead of guessing.

Acceptance Criteria:
- [ ] Relevance gate `pass` = unanimous YES across the votes; `fail` (reject) = unanimous NO; anything split = `review`.
- [ ] The individual votes and their one-line reasons are visible in the moderation card.

**US-004: POI gate (three-tier, with auto-reassign)**
> As the admin, I want the AI to confirm the item belongs to its assigned POI — or, if
> it really belongs to that POI's owner or its containing park boundary, to move it
> there automatically — and only drop it on me when neither can be confirmed.

The gate resolves in three tiers:

1. **Relevant to the assigned POI?** → `pass`, keep the POI as-is.
2. **Otherwise, more relevant to the POI's _owner_ (its `owner_id` organization) or its
   _immediate geofence_ (the smallest boundary POI that contains it — e.g. Liberty Park
   Nature Center → its parent *Liberty Park* boundary)?** → **reassign** `poi_id` to that
   owner/boundary POI and `pass`.
3. **Neither can be confirmed** → `review` (drop into the pending queue).

Acceptance Criteria:
- [ ] The relevance vote also returns whether the content is about the assigned POI (folded into the existing call — Tier 1 costs no extra round-trips).
- [ ] Tier 2 candidate POIs come from existing relationships: `pois.owner_id` (owner org) and the smallest containing boundary POI (via the `getContainingBoundaries` machinery in `geoService.js`). A single follow-up LLM call — made **only** for items that fail Tier 1 — picks the best-fitting candidate or "none".
- [ ] On a Tier 2 match, `poi_id` is updated to the owner/boundary POI; the gate verdict records the reassignment (old → new POI) for visibility.
- [ ] POI gate never auto-rejects. Tier 3 routes to `pending` with a "Check POI" signal.
- [ ] If PostGIS / geo lookups are unavailable, Tier 2 degrades gracefully to Tier 3 (review) rather than erroring — mirroring `getRollupPoiIds`.

### Backlog throughput

**US-005: Sweep keeps up with a monthly dump**
> As the admin, I want the scoring sweep to clear a monthly backlog in a reasonable
> number of cycles, so the queue isn't stuck showing hundreds of unscored items.

Acceptance Criteria:
- [ ] The per-cycle sweep batch size is a configurable setting (default raised from 20).
- [ ] After the sweep runs, pending items carry gate verdicts and a confidence score (no more `null` scores sitting in the queue).

---

## Data Model

### Schema Changes

```sql
-- Per-item structured gate verdicts (idempotent, additive)
ALTER TABLE poi_news   ADD COLUMN IF NOT EXISTS moderation_gates JSONB;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderation_gates JSONB;
```

`moderation_gates` shape:
```json
{
  "date":      { "verdict": "pass|review|fail", "reason": "...", "trusted_source": true },
  "relevance": { "verdict": "pass|review|fail", "reason": "...", "yes": 3, "total": 3 },
  "poi":       { "verdict": "pass|review", "tier": 1, "reason": "...", "reassigned_from": null, "reassigned_to": null }
}
```

### New `admin_settings`

| key | default | purpose |
|-----|---------|---------|
| `moderation_date_floor_year` | `2010` | dates below this year are implausible → date gate `review` |
| `moderation_sweep_batch_size` | `50` | items processed per type per sweep cycle |

Reuses existing `moderation_trusted_domains` and `moderation_news_date_threshold`.

---

## API Endpoints

No new endpoints. `GET /api/admin/moderation/queue` gains a `moderation_gates` field per item; the two new keys are added to the allowed `admin_settings` write list.

---

## UI/UX Requirements

### Modified Components

- `ModerationExtras` — add three gate badges (Date / Relevance / POI), colored
  green (`pass`) / orange (`review`) / red (`fail`), each with its reason as a tooltip;
  expand to show the relevance votes. Existing confidence % and triage chips stay.

---

## Non-Functional Requirements

**NFR-001: No added LLM cost**
- The POI judgment folds into the existing relevance-vote call. No new per-item model round-trips.

**NFR-002: Idempotent + backward compatible**
- Migration is additive and re-runnable. Items without `moderation_gates` render exactly as today.

---

## Open Questions

_None blocking — defaults chosen per Scott's review and the "old news is valuable" rule._

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-29 | Initial draft |
