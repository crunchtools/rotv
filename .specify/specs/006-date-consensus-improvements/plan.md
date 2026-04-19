# Implementation Plan: Date Consensus Improvements

> **Spec ID:** 006-date-consensus-improvements
> **Status:** Planning
> **Last Updated:** 2026-04-19
> **Estimated Effort:** M

## Summary

Five fixes to the date consensus scoring pipeline, unified under a single scoring path shared by both the collection and moderation pipelines. Core change: replace single LLM date call with 5-vote consensus system.

---

## Architecture

### Scoring Flow

```
                    ┌──────────────────────────────┐
                    │     dateExtractor.js          │
                    │  (shared scoring functions)   │
                    │                               │
                    │  scoreDateConsensus()         │
                    │  scoreLlmConsensus()    NEW   │
                    │  extractUrlDate()     UPDATED │
                    │  normalizeDateSources()       │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ processOneUrl│  │ processItem  │  │   fixDate    │
    │ (collection) │  │ (mod sweep)  │  │ (admin btn)  │
    │              │  │              │  │              │
    │ Has rendered │  │ Re-renders   │  │ Requeues →   │
    │ page already │  │ if score < 4 │  │ processItem  │
    └──────────────┘  └──────────────┘  └──────────────┘
```

### LLM Multi-Vote Flow

```
Page content (2000 chars) + "Today's date is YYYY-MM-DD"
    │
    ├──→ Gemini Flash call 1 ──→ "2026-02-09"
    ├──→ Gemini Flash call 2 ──→ "2026-02-09"
    ├──→ Gemini Flash call 3 ──→ "2026-02-09"  ──→ 5/5 unanimous
    ├──→ Gemini Flash call 4 ──→ "2026-02-09"      = 4 pts (llm-consensus)
    └──→ Gemini Flash call 5 ──→ "2026-02-09"
                                                     │
    Competing deterministic points                    │
    (time-tags, json-ld for OTHER dates)              │
              │                                       │
              └──→ subtract from 4 ──→ final LLM score
```

---

## Implementation Steps

### Phase 1: Shared Scoring Functions (dateExtractor.js)

- [ ] 1.1 Add `scoreLlmConsensus()` function
  - Input: array of 5 date strings + competing deterministic point total
  - Output: `{ date, score, label, votes }`
  - Unanimous (5/5) → `max(0, 4 - competingPoints)`, label `llm-consensus`
  - Majority (3-4/5) → 1, label `llm-majority`
  - No majority → 0, label `llm-split`

- [ ] 1.2 Update `extractUrlDate()` with new patterns
  - Add Pattern 2: YYYYMMDD in path segment (`/news/20250929-article`)
  - Add Pattern 3: /YYYY/MMDD (`/release/2026/0109`)
  - Keep existing Pattern 1: /YYYY/MM/DD/

- [ ] 1.3 Add helper: `runLlmDateVotes(pool, snippet, numVotes)`
  - Builds prompt with today's date seed
  - Runs `numVotes` parallel Gemini Flash calls
  - Returns array of parsed date strings (or null)
  - Shared by both collection and moderation paths

### Phase 2: Collection Pipeline (newsService.js)

- [ ] 2.1 Remove `dateModified` from JSON-LD collection in contentExtractor.js (line 156)

- [ ] 2.2 Add Instagram URL normalization
  - New function `normalizeSourceUrl()` — `/reel/ID` and `/reels/ID` → `/p/ID`
  - Apply before `extractPageContent()` in `processOneUrl`
  - Store original URL as `source_url` (normalize for rendering only)

- [ ] 2.3 Replace single LLM date call with multi-vote in `processOneUrl`
  - Replace the single `generateTextWithCustomPrompt` date call (current lines ~385-391)
  - Call `runLlmDateVotes(pool, snippet, 5)`
  - Compute competing deterministic points from other sources
  - Call `scoreLlmConsensus()` to get final LLM score
  - Add LLM result to consensus scoring as `llm-consensus`, `llm-majority`, or discard

- [ ] 2.4 Update date seeding for event extraction prompt
  - Event prompt already has `The current year is ${new Date().getFullYear()}`
  - Align to use full date: `Today's date is ${today}.`

### Phase 3: Moderation Pipeline (moderationService.js)

- [ ] 3.1 Modify `processItem` for news/events
  - After reading existing `date_consensus_score`:
    - If score >= threshold → apply threshold, set `moderation_processed = true` (fast path, no re-render)
    - If score < threshold → run full consensus pipeline:
      1. `extractPageContent(source_url)` — render page
      2. Extract deterministic sources from `ogDates` (JSON-LD, meta, time-tags)
      3. `extractUrlDate(source_url)` — URL pattern
      4. `runLlmDateVotes(pool, snippet, 5)` — multi-vote
      5. `scoreDateConsensus()` + `scoreLlmConsensus()` — final score
      6. Update `publication_date`, `date_consensus_score` in DB
      7. Apply threshold

- [ ] 3.2 Simplify `fixDate` to requeue + processItem
  - Remove chrono-node path
  - Remove standalone Gemini call
  - Remove hardcoded `date_consensus_score = 6`
  - New behavior: set `moderation_processed = false`, call `processItem()` directly
  - Return the new score and date to the admin UI

### Phase 4: Testing

- [ ] 4.1 Unit tests for `scoreLlmConsensus()`
  - 5/5 unanimous, no competing → score 4
  - 5/5 unanimous, 3 competing points → score 1
  - 5/5 unanimous, 5 competing points → score 0
  - 4/5 majority → score 1
  - 3/5 majority → score 1
  - 2/5 split → score 0
  - All null → score 0

- [ ] 4.2 Unit tests for updated `extractUrlDate()`
  - `/2024/03/15/article` → `2024-03-15` (existing)
  - `/news/20250929-article.htm` → `2025-09-29` (new)
  - `/release/2026/0109` → `2026-01-09` (new)
  - `/ramblings/the-unicorn` → null (no date)
  - `/some/path/999999-thing` → null (invalid date)

- [ ] 4.3 Unit test for Instagram URL normalization
  - `/reel/ABC123/` → `/p/ABC123/`
  - `/reels/ABC123/` → `/p/ABC123/`
  - `/p/ABC123/` → `/p/ABC123/` (no change)
  - Non-Instagram URLs → unchanged

- [ ] 4.4 Integration test: processItem re-scores below-threshold items
  - Insert item with score 2, `moderation_processed = false`
  - Run `processItem`
  - Verify page was rendered and LLM consensus was run
  - Verify score updated in DB

- [ ] 4.5 Integration test: processItem fast-paths above-threshold items
  - Insert item with score 5, `moderation_processed = false`
  - Run `processItem`
  - Verify NO page render occurred
  - Verify item auto-approved

- [ ] 4.6 Manual: verify in browser
  - Check moderation queue before/after deploy
  - Verify auto-approved items appear correctly on map
  - Verify "Fix Date" button triggers rescore

### Phase 5: Deploy & Migration

- [ ] 5.1 Build container, run tests
- [ ] 5.2 Deploy to production
- [ ] 5.3 Run requeue migration:
  ```sql
  UPDATE poi_news SET moderation_processed = false WHERE moderation_status = 'pending';
  UPDATE poi_events SET moderation_processed = false WHERE moderation_status = 'pending';
  ```
- [ ] 5.4 Monitor moderation sweep logs for rescore results
- [ ] 5.5 Verify ~41 items auto-approved, ~15 remain pending

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/dateExtractor.js` | Add `scoreLlmConsensus()`, add `runLlmDateVotes()`, update `extractUrlDate()` with 2 new patterns |
| `backend/services/contentExtractor.js` | Remove `item.dateModified` from JSON-LD candidates (line 156) |
| `backend/services/newsService.js` | Replace single LLM date call with multi-vote consensus in `processOneUrl`, add Instagram URL normalization, update date seeding |
| `backend/services/moderationService.js` | Rewrite `processItem` news/event path to run full consensus pipeline when score < threshold. Simplify `fixDate` to requeue + processItem |

### No New Files

All changes fit within existing files. `scoreLlmConsensus()` and `runLlmDateVotes()` live in `dateExtractor.js` alongside the existing scoring functions.

---

## Database Migrations

No schema changes. One-time post-deploy data migration:

```sql
-- Requeue all pending items for rescoring with new pipeline
UPDATE poi_news SET moderation_processed = false WHERE moderation_status = 'pending';
UPDATE poi_events SET moderation_processed = false WHERE moderation_status = 'pending';
```

---

## Rollback Plan

If issues are discovered:
1. Revert container to previous image (`podman pull` previous tag)
2. No schema changes to roll back
3. Items that were auto-approved by the new scoring can be bulk-requeued from the admin UI if dates are wrong

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM consensus unanimously agrees on wrong date (systematic bias) | High — wrong dates auto-approved | Competing deterministic penalty catches cases where structural data disagrees. Monitor logs for items where LLM overrides structural sources. |
| Moderation sweep takes too long with page rendering | Med — sweep can't finish 20 items in 15 min window | Only re-renders items below threshold. Items scored during collection skip rendering. Rate is ~2 items/minute with parallel LLM calls. |
| Gemini Flash API rate limits on 5x parallel calls | Low — calls are tiny | Gemini Flash has generous rate limits. If hit, catch and fall back to fewer votes. |
| Instagram `/p/` normalization breaks on private accounts or deleted posts | Low — same failure mode as `/reel/` | Normalization is rendering-only; original URL preserved as source_url |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-04-19 | Initial plan |
