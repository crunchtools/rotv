# Implementation Plan: Editor's draft of the weekly digest

**Spec:** [spec.md](spec.md) · **Issue:** #734

## Summary
Expose the digest's own content query as data over MCP, build previews as of the real send instant, and add a per-item exclusion flag.

## Changes by file
- `backend/migrations/096_add_digest_excluded.sql`: `digest_excluded BOOLEAN NOT NULL DEFAULT FALSE` on `poi_news` and `poi_events`. Idempotent.
- `backend/services/newsletterDigestService.js`:
  - `upcomingSendISO(tz, now)` replaces `upcomingFridayISO`: Friday 08:00 in `tz`, offset taken on the send day.
  - `fetchDigestContent` also returns `newsBench` and `eventsOverflow`; both its queries and both personalized-digest queries add `NOT digest_excluded`.
  - `getDigestDraft(pool, { tz, asOf })` and `setDigestExcluded(pool, contentType, id, excluded)`.
- `backend/services/mcpServer.js`: `digest_draft`, `digest_exclude`.
- `backend/tests/newsletterDigestDraft.unit.test.js`: send instant across weekdays, the fall time change and a second timezone; caps and bench; window parameters; exclusion in both queries; host filter; location line; flag updates.

## Testing
Unit tests above. After deploy, compare `digest_draft` with the headlines of a sent issue pulled from Buttondown, and round-trip `digest_exclude` on one event.

## Risks
- The Trentina gateway must allowlist the two tools before the skill can call them.
- The preview email's window moves to the send instant. That is the fix, but a Thursday preview will now list slightly different news than it did.
