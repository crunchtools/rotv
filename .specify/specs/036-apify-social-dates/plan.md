# Implementation Plan: Apify Social Date Capture

> **Spec:** 036-apify-social-dates
> **Status:** In Progress

## Architecture

The seam is `renderPage()` (`backend/services/renderPage.js`), the single wrapper every
collection/moderation path uses to turn a URL into content (`extractPageContent` is called
nowhere else). Branch there: social URLs → Apify; everything else → headless renderer. The
Apify result is shaped exactly like an `extractPageContent` result (`markdown`, `rawText`,
`ogDates.socialDates`, `reachable`), so the rest of the pipeline — including the `social`
date signal wired in PR #496 — needs no further change. Apify results are cached in
`rendered_page_cache` like any render, so repeat collections don't re-bill.

Trail status branches to `fetchFacebookPosts` *before* `renderPage`, so it is untouched.

## Changes

### `backend/services/apifyService.js`
- Add `INSTAGRAM_ACTOR_ID = 'apify~instagram-scraper'`.
- Add `isInstagramUrl`, `isSocialUrl`, `extractInstagramUrl` (validate/normalize directUrl).
- Add `toIsoDate(raw)` — epoch seconds, epoch ms, or ISO string → `YYYY-MM-DD`.
- Add `fetchSocialPosts(pool, url, maxItems)`:
  - Detect FB vs IG; run the right actor (FB: `{startUrls,maxPosts}`; IG:
    `{directUrls, resultsType:'posts', resultsLimit}`).
  - Defensive field parsing: text from `caption|text|message|postText`; timestamp from
    `timestamp|time|date|takenAt|takenAtTimestamp|publishedTime`.
  - Return an `extractPageContent`-shaped object: `{ markdown, rawText, title:null,
    ogDates:{ socialDates }, ogImage:null, links:[], reachable, reason }`.
- Refactor `fetchFacebookPosts` to delegate to the shared actor runner, preserving its
  `{ markdown, reachable, reason }` contract for trail status.

### `backend/services/renderPage.js`
- Import `fetchSocialPosts`, `isSocialUrl`.
- Read `social_apify_collection_enabled` (default true) only when the URL is social.
- If social + enabled + token present → `fetchSocialPosts`; else → `extractPageContent`
  (headless renderer, which falls back to the embedded-timestamp harvest from PR #496).

### `backend/routes/admin.js`
- Add `social_apify_collection_enabled` to the settings allow-list.

### Tests (`backend/tests/apifyService.unit.test.js`)
- URL detection (`isInstagramUrl`/`isSocialUrl`).
- `toIsoDate` for epoch-s / epoch-ms / ISO / garbage.
- `fetchSocialPosts` parsing with a mocked `fetch` + mocked token query (FB and IG shapes),
  asserting `socialDates` and `markdown`.

## Test & Ship
- `node --check` each file → `./run.sh test` (full suite) → commit → push → PR (stacked on #496).
