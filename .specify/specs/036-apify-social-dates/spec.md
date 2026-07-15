# Specification: Apify Social Date Capture (Facebook & Instagram)

> **Spec ID:** 036-apify-social-dates
> **Status:** Superseded (news-pipeline social scraping removed by #551 / PR #559, 2026-07-15)
> **Version:** 0.1.0
> **Author:** Scott McCarty (with Josui)
> **Date:** 2026-06-19

> **Superseded:** The news-collection social scraping described here (Facebook + Instagram
> via Apify in `renderPage`, gated by `social_apify_collection_enabled`) was removed in #551 /
> PR #559 — Serper snippet recovery covers dated social results well enough that the per-run
> Apify cost wasn't justified. Apify is now scoped to **Facebook trail status only**
> (`apifyService.fetchFacebookPosts`, used by `trailStatusService`); see
> `docs/TRAIL_STATUS_ARCHITECTURE.md`. US-036-1/2 no longer apply; US-036-3's carve-out
> (trail-status Facebook scraping unaffected) is the surviving behavior.

## Overview

Facebook and Instagram are ~48% of the news moderation queue, yet they reach the news
collection path through the headless browser (`renderPage` → `contentExtractor`), which
logged-out social pages rarely render usefully — so these items arrive with no structural
publication date and depend on LLM guesses the date gate then distrusts. This feature routes
social URLs through the Apify scrapers (which are authenticated and proxied) to capture the
**real post timestamp**, feeding it into the `social` date signal added in spec 030/PR #496 so
social content clears the date gate on its own.

---

## User Stories

### Date Accuracy

**US-036-1: Real Facebook post dates**
> As the collection pipeline, I want the actual Facebook post timestamp so that social news
> publishes with a correct, structurally-sourced date instead of an LLM guess.

Acceptance Criteria:
- [ ] A Facebook source URL is fetched via the Apify Facebook posts scraper.
- [ ] Each post's timestamp is captured and exposed as `ogDates.socialDates` (YYYY-MM-DD).
- [ ] The date gate sees a deterministic `social` signal (weight 4) and can auto-pass.

**US-036-2: Instagram support**
> As the collection pipeline, I want Instagram posts scraped too, since ROTV follows several
> official park Instagram accounts (cuyahogavalleynps, Conservancy for CVNP).

Acceptance Criteria:
- [ ] An Instagram source URL (profile or post) is fetched via the Apify Instagram scraper.
- [ ] Post `caption` becomes the content text; `timestamp` becomes a `social` date.

**US-036-3: Graceful fallback / kill switch**
> As an admin, I want to disable Apify social collection (it bills per run) without breaking
> trail-status Facebook scraping.

Acceptance Criteria:
- [ ] Setting `social_apify_collection_enabled` (default true) gates social routing in `renderPage`.
- [ ] When disabled or when no Apify token is configured, social URLs fall back to the headless
      renderer + embedded-timestamp harvest (best-effort, no Apify cost).
- [ ] Trail-status Facebook scraping (`fetchFacebookPosts`) is unaffected.

---

## Data Model

No new tables. No migration — the new setting defaults to `true` in code when absent.

### Settings

| Key | Default | Description |
|-----|---------|-------------|
| `social_apify_collection_enabled` | `true` | Route FB/IG news collection through Apify |
| `apify_api_token` | (existing) | Reused; absence disables Apify social fetch |

---

## API Endpoints

None. `social_apify_collection_enabled` is added to the admin settings allow-list so it is
editable via the existing settings UI/MCP.

---

## Non-Functional Requirements

**NFR-036-1: Cost control**
- Apify bills per actor run. Social fetches are cached in `rendered_page_cache` (existing TTL),
  so repeat collections within the listing TTL do not re-run the actor.
- The Instagram actor is a separate paid actor from the Facebook one.

**NFR-036-2: No regression**
- Trail-status FB scraping keeps its `{ markdown, reachable, reason }` contract.
- Defensive timestamp/text parsing tolerates actor output-field variations.

---

## Dependencies

- Depends on: spec 030 / PR #496 (the `social` date source consumer). This feature only
  *populates* `ogDates.socialDates`; PR #496 wires its consumption end-to-end.
- Apify actors: `apify~facebook-posts-scraper` (existing), `apify~instagram-scraper` (new).

---

## Open Questions

1. Facebook post-level granularity: the FB scraper takes a page URL and returns recent posts,
   so a specific historical FB post may not be re-fetchable at moderation time. Acceptable —
   the date is captured at collection time and stored.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-06-19 | Initial draft |
