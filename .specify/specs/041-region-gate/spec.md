# Specification: Region Gate (Fourth Auto-Moderation Gate)

> **Spec ID:** 041-region-gate
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-07-17

## Overview

Spec 030 restructured auto-moderation around three independent gates — **Date**,
**Relevance**, and **POI correctness**. Geography was folded into the Relevance vote
(the prompt told voters to reject content "about a place OUTSIDE Northeast Ohio").

That fold-in has a hole. A relevance vote counts as affirmative when the content is
`relevant` **OR** `about_poi` (PR #483, so a mapped commercial POI's own news passes).
For a geographically-broad entity POI — e.g. "US Coast Guard" — an out-of-region story
is genuinely `about_poi: true`, so it passes the Relevance gate on the `about_poi`
branch even when every voter set `relevant: false` and explicitly named the wrong
state. The geographic judgment was being made correctly and then discarded.

Live example (news #5416): a Coast Guard change-of-command ceremony in Portsmouth,
Virginia auto-published to the digest. All three voters wrote `relevant: false,
about_poi: true` with reasoning "…in Virginia, which is outside Northeast Ohio."

This spec promotes geography to its own **fourth gate**: **Region**. Relevance becomes
pure topical fit; Region answers, independently, "is the subject physically in
Northeast Ohio?" A unanimous out-of-region verdict rejects, regardless of `about_poi`.

---

## User Stories

### Region gating

**US-001: Region is its own gate**
> As the site admin, I want a dedicated geography check so out-of-region content is
> rejected even when it is legitimately *about* a mapped organization that also
> operates locally.

Acceptance Criteria:
- [ ] Auto-publish requires all **four** gates to pass: Date, Relevance, Region, POI.
- [ ] Region runs as an independent 3-vote LLM consensus, mirroring Relevance.
- [ ] A **unanimous** out-of-region verdict sets `moderation_status = 'rejected'`.
- [ ] A **unanimous** in-region verdict passes the gate.
- [ ] Anything else (a split, or fewer than 3 successful votes) → `pending` review; the
      Region gate never auto-rejects on a split and never auto-rejects on LLM failure.

**US-002: Relevance judges topic only**
> As a maintainer, I want the Relevance prompt to stop judging geography so the two
> concerns don't interfere.

Acceptance Criteria:
- [ ] The "OUTSIDE Northeast Ohio" reject criterion is removed from the Relevance prompt.
- [ ] `about_poi` is preserved (the POI gate still consumes it).

**US-003: Decisions stay auditable**
> As the site admin, I want to see the Region verdict alongside the other gates.

Acceptance Criteria:
- [ ] `moderation_gates` JSONB carries a `region` object (verdict, reason, in_region count, total).
- [ ] The item's `ai_reasoning` summary includes the region verdict.

### Non-goals

- No distance/coordinate geofencing. Region is an LLM judgment, not a spatial query.
  (A future spec may add coordinate checks; this reuses the judgment voters already make.)
- No change to Date or POI gate behavior.

---

## Design Notes

- **Concurrency:** Region and Relevance votes are issued together via `Promise.all`, so
  the fourth gate adds LLM cost (~3 Flash calls/item, negligible) but no wall-clock latency.
- **Consensus function:** `evaluateRegionGate(votes)` is a pure, exported function
  (mirrors `evaluateDateGate`) so the pass/fail/review logic is unit-tested without a DB
  or LLM. 3 votes required; `inCount === total` → pass, `inCount === 0` → fail, else review.
- **Prompt:** judges by where the *subject* physically is, explicitly instructing that a
  national/multi-state organization's activity elsewhere is out of region even when the
  org also operates locally. Ambiguous-location content leans in-region (collection
  already scoped the source).

---

## Test Plan

- Unit (`moderationService.test.js`): unanimous-in → pass; unanimous-out → fail
  (Coast Guard #5416 regression fixture); split → review; <3 votes → review.
- Manual: re-moderate a known out-of-region item and confirm `rejected` with a
  `region` gate in `moderation_gates`.

---

## Follow-on cleanup (same PR)

Two dead/low-value mechanisms are removed alongside the Region gate, since the
investigation that surfaced the #5416 bug also established they no longer earn their keep.

**Numeric confidence scoring — removed.** The 0–8 `confidence_score` model predates the
gate architecture. `applyQualityFilters()` was test-only; the news/event path never wrote
`confidence_score` (only a misleading log). Its sole live consumer was photo auto-approve,
and `photo_submissions` has zero rows — no uploads, ever. Removed: `applyQualityFilters`,
`serializeIssues`, the vestigial score log, `moderatePhoto`, the photo confidence
threshold setting/UI. Photos now go straight to manual review (`forceStatus` still honored).
DB `confidence_score` columns are left in place (inert) to avoid a needless migration.

**Trusted domains — removed.** `moderation_trusted_domains`'s only live effect was letting
a weak-consensus date pass the Date gate. Data: 22 lifetime saves (21 news + 1 event) —
real but tiny, and the "trusted" name caused this very bug to be misdiagnosed. Removed from
the Date gate (`evaluateDateGate` no longer takes `sourceUrl`/`trustedSet` or emits
`trusted_source`), the settings load, admin allow-list, and the settings UI. Trade-off:
~2–3 official items/week with broken machine-readable dates now land in `pending` instead
of auto-publishing. (The separate `trusted_content_paths` collection setting is unrelated
and untouched.)
