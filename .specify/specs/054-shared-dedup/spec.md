# Spec 054: One duplicate matcher for news and events

## Why
The Oct 23, 2026 digest ran the Primate Forest opening twice. Four places decided what a duplicate is, with three rules: save-time (same URL, or same title at the same POI), moderation (same title at the same POI), and the digest (word overlap at the same POI; same POI, title and day for events). None matched across POIs, so one story filed under two POIs, or one event listed by two organizers, sent twice. The digest kept the first match it found, so the result depended on input order, and every outlet's page chrome ("Published: … Updated: 16 hours ago") needed its own fix.

## Behavior
- `backend/services/dedup/` holds the matching. It is pure: no database access except `candidates.js`, which loads every POI name for the match context.
- A batch is grouped by comparing every pair and joining matches transitively (union-find). The grouping does not depend on input order. Each caller chooses which item of a group to keep: the digest keeps the freshest, or a same-outlet copy with a fuller summary.
- Every match carries a reason: `url`, `title`, `outlet`, `entity:<name>`, `text`, `text+date` for news; `url`, `slot`, `venue` for events.
- News signals, in order:
  - `url`: a canonical URL in common, alternate links from `poi_news_urls` included.
  - `title`: the same normalized headline, or one cut short with an ellipsis that the other starts with.
  - `outlet`: one host within 2 calendar days, with a shared name, or alike headlines plus corroborating text.
  - `entity`: a shared distinctive name that appears in a headline, plus text overlap.
  - `text`: same POI only. The share of the shorter item's 4-character n-grams found in the longer one; short items need more, and two short items are scored by Dice.
- Two items at different POIs need `url`, `title`, `outlet` or `entity`.
- A name is distinctive when it is not made only of POI-name words, region words, the outlet's own name, or calendar words. A name carried by more than a quarter of the batch is ignored.
- Event signals: the same calendar day is required.
  - `url`: the same URL with alike titles.
  - `slot`: the same POI or venue POI, alike titles, and start times within 30 minutes. Times may differ when the titles are identical or one start is the bare-date noon fallback.
  - `venue`: the same venue (by `venue_poi_id` or venue text), starts within 30 minutes, and alike titles.
- `canonicalUrl` is applied in memory only. It is a superset of the SQL identity `LOWER(REGEXP_REPLACE(url, '/+$', ''))`, which the unique index and save-time lookup keep using.
- Thresholds live in `context.js`. A caller can pass stricter ones.
- A headline that names a date only matches a headline naming the same date ("Fishing Report: October 1" vs "October 8"). A shared URL also needs alike headlines when the caller asks (`urlTitle`), because some URLs are living pages.

## Moderation
- The duplicate check runs first in `processItem`, before the LLM votes. `findNewsCandidates` and `findEventCandidates` fetch published items at any POI with a trigram-similar title (pg_trgm `%`, migration 011's index) or the same URL, within 14 days for news and 1 day for events.
- News is rejected only as a copy under `MODERATION_NEWS_THRESHOLDS`: the same link with a like headline, or one outlet running the same story twice (same headline, near-identical headlines, or near-identical text). Two outlets reporting the same news are two articles, not a duplicate: a reader may not have one outlet's subscription or may prefer a writer (Scott, Oct 24 2026). Shared names never reject. A rejected story leaves the site.
- A news match only under the digest's thresholds is recorded as `moderation_gates.duplicate` (`{ verdict: 'info', of, reason, score }`) and noted in `ai_reasoning`. It does not change the outcome: the digest folds it at send time, and on the site a second take is fine. Holding these would add about five items a week to the queue (replay: 143 of 989).
- An event match rejects.
- `forceStatus` skips the rejection.
- Merge suggestions (`getMergeCandidates`) list likely duplicates at any POI first, with `match_reason` and `poi_name`, then the item's own POI's recent items.
- Save-time dedup is unchanged: an exact URL, or an exact title at the same POI, merges the link into the existing row. Fuzzy and cross-POI decisions belong to moderation, which runs on every saved item and whose rejections can be requeued. A save-time merge cannot be undone and would discard the incoming title and summary.

## Tests
- `tests/fixtures/dedup/*.json`: real pairs from the May–Oct 2026 digests, each with `expected`, `why` and, for a match, the `reason`. `moderation-pairs.json` holds copies that must reject and related stories that must stay.
- Property tests:
  - the matcher gives the same verdict in both directions
  - the grouping is the same for any input order
  - deduping its own output changes nothing
  - appending page chrome never splits a story

## Out of scope
- Embeddings or an LLM judge.
