# Specification: Unify Newsletter Extraction into the Collection Pipeline

> **Spec ID:** 020-unify-collection-extraction
> **Status:** Draft
> **Version:** 0.2.0
> **Author:** Scott McCarty (with Josui)
> **Date:** 2026-05-21

## Overview

Newsletter ingestion (`newsletterService.js`) and AI collection (`newsService.js`) extract content through two divergent code paths. The newsletter path asks Gemini to produce structured items **including `source_url` and dates in one shot**, while the collection path forbids Gemini from setting URLs/dates and derives them deterministically. This divergence is the root cause of the newsletter "homepage link" bug (Gemini fabricated `akronzoo.org/` instead of using the real per-item links) and means newsletter events skip the date-consensus scoring every other event gets.

This spec unifies the two: a newsletter is tied to **one POI** (the sending organization), its **"view in browser" page is crawled as the entry page**, and the existing classifier decides **listing vs. detail** — after which the standard crawl → extract → score → save pipeline does everything. `newsletterService.js` shrinks to *ingest + resolve POI + hand off*.

---

## Background: why they differ today

| Concern | Collection path (`newsService.js`) | Newsletter path (`newsletterService.js`) |
|---------|-----------------------------------|------------------------------------------|
| URL selection | Deterministic — `item.source_url = url` (rendered page's URL). Prompt: *"Do NOT include date or source_url fields"* | **Gemini emits `source_url`** → hallucinated the homepage |
| Dates | Separate date-scoring pipeline (`date_consensus_score`, `date_signals`) | **Gemini emits dates** → no consensus scoring, past-dated noise |
| Link/page handling | Render URL → classify listing/detail → `isNoiseLink` + dedup + redirect resolution | One-shot Gemini extraction over whole-email markdown; bespoke `resolveItemUrls` |
| POI assignment | Job is scoped to one known POI | `matchItemsToPois` by name-substring over all POIs |
| Item extraction | `processPage` per rendered detail page | Single Gemini call over the email |

The collection path embodies **"Gemini classifies/extracts content; everything structural (URLs, dates) is deterministic."** Unification makes the newsletter obey the same principle by reusing the same pipeline.

---

## Resolved Design Decisions (2026-05-21)

**D1 — One newsletter = one POI.** A newsletter comes from a specific organization (e.g., Akron Zoo → POI 5753), so the whole email is scoped to that POI, exactly like a collection job. This replaces per-item name-matching. Requires a **sender → POI mapping** (see Data Model). Unmapped senders are quarantined for one-click admin assignment (which creates the mapping for next time).

**D2 — Crawl the "view in browser" page as the entry page.** Most newsletters include a "View in browser / View as webpage" link that renders the full newsletter as a normal web page. Extract that link from the email and feed it into the standard pipeline as the entry URL for the POI. Fallback when absent: render the stored email HTML (`newsletter_emails.body_html`) as the entry page.

**D3 — Classify the entry page as listing vs. detail, then reuse everything.** The existing classifier decides: *listing* → extract detail links, crawl them, extract items; *detail* → extract the single item. From there the standard `processPage` → date-scoring → dedup → save path runs unchanged, tagged `content_source='newsletter'`. "Everything else just works."

Net effect: `newsletterService.js` keeps only the SMTP receiver, `newsletter_emails` logging, POI resolution, and entry-URL selection. It **drops** the bespoke extraction prompt, `matchItemsToPois`, and `resolveItemUrls`.

---

## User Stories

**US-001: Newsletter bound to its organization's POI**
> As a maintainer, I want each newsletter routed to the single POI for its sending organization, so its items attach to the right place without per-item guessing.

Acceptance Criteria:
- [ ] A sender → POI mapping resolves the Akron Zoo newsletter to POI 5753.
- [ ] An unmapped sender is quarantined with an admin action to assign a POI (persisting the mapping).
- [ ] All items from one newsletter attach to that one POI.

**US-002: Single extraction pipeline, deterministic deep links**
> As a maintainer, I want newsletters to flow through the same crawl/extract/score/save code as collection.

Acceptance Criteria:
- [ ] Newsletter items are produced by the shared `processPage`/save path (no parallel Gemini prompt emitting URLs/dates).
- [ ] `source_url` comes from the resolved destination page, never inferred by Gemini; re-processing the Akron Zoo "Renaissance Faire" email links to `akronzoo.org/renaissance-faire`, not `akronzoo.org/`.
- [ ] `newsletterService.js` no longer contains a bespoke item-extraction prompt, `matchItemsToPois`, or `resolveItemUrls`.

**US-003: Consistent dates and dedup**
> As a moderator, I want newsletter events scored and deduped like collected events.

Acceptance Criteria:
- [ ] Newsletter events populate `date_consensus_score`/`date_signals`.
- [ ] Newsletter items dedup against existing `poi_news`/`poi_events` via the shared dedup.

---

## Data Model

New mapping table (admin-managed):

```sql
CREATE TABLE IF NOT EXISTS poi_newsletter_sources (
  id           SERIAL PRIMARY KEY,
  poi_id       INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  from_pattern TEXT NOT NULL,   -- match against the email From: (e.g. 'info-akronzoo.org@shared1.ccsend.com' or '%akronzoo.org%')
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

Notes:
- Constant Contact relays from `…@shared1.ccsend.com`, so the org identity often lives in the From local-part / `List-Unsubscribe` header / body, not the sending domain — `from_pattern` is matched as a LIKE/regex against the stored `from_address`.
- No other schema change; `content_source='newsletter'` already exists. Newsletter events will now also populate `date_consensus_score`, `date_signals`, `rendered_content` (previously null).
- `newsletter_emails` remains the ingestion log/entry point.

---

## Processing Flow (target)

1. SMTP receiver stores raw email in `newsletter_emails`, queues a job (unchanged).
2. Resolve POI via `poi_newsletter_sources` against `from_address`. No match → quarantine (status on `newsletter_emails`) + admin assignment.
3. Select entry URL: "view in browser" link if present, else render stored `body_html`.
4. Hand `(entryUrl|html, poi)` to the standard pipeline as a single-POI job.
5. Standard classify (listing/detail) → crawl → extract → date-score → dedup → save with `content_source='newsletter'`.

---

## Non-Functional Requirements

**NFR-001: Cost / performance** — crawling links is heavier than one-shot email extraction. Apply the same per-job page caps as collection and reuse `renderPage` caching (see `docs/NEWS_COLLECTION_INEFFICIENCIES.md`).

**NFR-002: Graceful degradation** — a link/page that won't render must not fail the whole newsletter; skip that item. If the entry page itself won't render, fall back to the stored email HTML.

**NFR-003: No ingestion regression** — SMTP receiver, `newsletter_emails` logging, and `newsletter_reprocess` keep working.

---

## Dependencies

- Depends on: `newsService.js` crawl/extract/save being invocable for a single POI given an entry URL or raw HTML (not only DB-driven POI jobs).
- Supersedes: the interim prompt band-aid `fix: extract source_url verbatim from newsletters` (branch `fix/collection-url-and-grounding`). The Serper "floor grounding to Ohio" fix on that branch is independent and should ship regardless.
- Related: `docs/NEWS_COLLECTION_INEFFICIENCIES.md` (cost controls to respect).

---

## Open Questions

1. **Sender mapping admin UX:** new admin screen for `poi_newsletter_sources`, or fold "assign POI" into the existing newsletter admin view as a one-click action on a quarantined email?
2. **Entry-page rendering of stored HTML:** does the pipeline accept a raw HTML string as a "page", or do we always prefer a real URL ("view in browser") and only fall back to HTML when present? (Affects how much of `crawlPage` needs a non-URL entry mode.)
3. **Exhibit-announcement event/news split** (Primate Passage / DinoTrek): orthogonal; fold in here or leave to the classifier?

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-21 | Initial draft |
| 0.2.0 | 2026-05-21 | Resolved POI mapping (one newsletter = one POI + `poi_newsletter_sources`), "view in browser" entry page, and listing/detail classification per Scott's direction |
