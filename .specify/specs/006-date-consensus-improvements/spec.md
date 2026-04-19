# Specification: Date Consensus Improvements

> **Spec ID:** 006-date-consensus-improvements
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty / Josui
> **Date:** 2026-04-19

## Overview

Improve the date consensus scoring pipeline to reduce false negatives (legitimate items stuck in moderation) and false positives (wrong dates auto-approved). The core change replaces the single LLM date extraction call with a 5-vote consensus system that scores based on unanimity, combined with several structural extraction fixes.

**Problem:** 56 items stuck in pending moderation. Only ~15 auto-approved. Root causes: (1) LLM hallucinating years without date context, (2) `dateModified` polluting JSON-LD scores, (3) URL date patterns not recognized, (4) no way to build confidence from LLM-only sources.

**Expected outcome:** ~41 of 56 current pending items would reach auto-approve threshold (score >= 4). The remaining ~15 are genuinely ambiguous or have no dates.

---

## Changes

### Fix 1: Remove `dateModified` from JSON-LD Collection

**File:** `backend/services/contentExtractor.js:154-159`

**Problem:** `dateModified` is collected into the same `jsonLdDates` array as `datePublished`. When a page has both (e.g., Davey Tree: published 2025-01-21, modified 2025-10-21), they compete as equal-weight sources. This caused the wrong date to be stored.

**Change:** Remove `item.dateModified` from the candidates array. Only collect `datePublished` and `startDate` from JSON-LD.

**Before:**
```javascript
const candidates = [
  item.datePublished,
  item.dateModified,     // REMOVE
  item.startDate,
  item['@graph']?.map?.(n => n.datePublished || n.startDate)
].flat().filter(Boolean);
```

**After:**
```javascript
const candidates = [
  item.datePublished,
  item.startDate,
  item['@graph']?.map?.(n => n.datePublished || n.startDate)
].flat().filter(Boolean);
```

**Impact:** Fixes accuracy for pages with both datePublished and dateModified. Davey Tree article now correctly scores 2025-01-21.

---

### Fix 2: LLM Multi-Vote Consensus (replaces single LLM call)

**Files:** `backend/services/newsService.js` (processPage), `backend/services/dateExtractor.js` (new scoring function)

**Problem:** A single LLM call at 2 pts is unreliable (hallucinated 1996, 2008, 2024 in production data) and insufficient to auto-approve items that lack structural metadata.

**Change:** Replace the single LLM date extraction call with 5 parallel calls using the same prompt. Score based on agreement level:

| Agreement | Score | Label |
|-----------|-------|-------|
| 5/5 unanimous | 4 pts (minus competing deterministic) | `llm-consensus` |
| 3/5 or 4/5 simple majority | 1 pt | `llm-majority` |
| No majority (2/5 or less) | 0 pts | discarded |

**Competing deterministic penalty:** When the LLM consensus date differs from dates found by deterministic sources (JSON-LD, meta tags, `<time>` elements, URL patterns), the LLM consensus score is reduced:

```
llm_score = max(0, 4 - sum_of_deterministic_points_for_other_dates)
```

This ensures:
- **LLM is the only source:** Full 4 pts. Justified because 5/5 agreement on seeded prompts is highly reliable (tested: 100% consistency on clear dates).
- **LLM agrees with structural data:** Full 4 pts + structural points. Very high confidence.
- **LLM disagrees with structural data:** LLM influence shrinks proportionally. Structural data wins when it has sufficient weight (>= 2 pts competing).
- **LLM is ambiguous (< 5/5):** 1 pt or 0 pts. Item stays in moderation.

**Prompt change:** Seed every LLM date extraction call with today's date:

```
Today's date is ${new Date().toISOString().substring(0, 10)}. Extract the primary publication or start date from this article/page snippet. Return ONLY the date in ISO format YYYY-MM-DD, or the word null if no date is present.

${snippet}
```

**Why date seeding:** Without today's date, the LLM cannot resolve relative timestamps ("2w", "3 days ago") and returns `null` or hallucinates years. With seeding, tested 10/10 consistent on relative dates, and ambiguous dates (past events without year) correctly produce split votes.

**Cost:** ~5x on Gemini Flash for the cheapest call in the pipeline (~2000 tokens total per item, ~400 per call). Calls run in parallel. Negligible cost increase.

**Consensus scoring function** (new in `dateExtractor.js`):

```javascript
/**
 * Run LLM date extraction N times and score by agreement.
 * @param {string[]} results - Array of extracted date strings (YYYY-MM-DD or null)
 * @param {number} deterministicCompetingPoints - Sum of deterministic source points for dates != consensus date
 * @returns {{ date: string|null, score: number, label: string, votes: Object }}
 */
export function scoreLlmConsensus(results, deterministicCompetingPoints = 0) {
  // Count votes per date (filter nulls)
  const votes = {};
  for (const r of results) {
    if (r && /^\d{4}-\d{2}-\d{2}$/.test(r)) {
      votes[r] = (votes[r] || 0) + 1;
    }
  }

  if (Object.keys(votes).length === 0) {
    return { date: null, score: 0, label: 'no-date', votes };
  }

  const total = results.length;
  const bestDate = Object.keys(votes).reduce((a, b) => votes[a] >= votes[b] ? a : b);
  const bestCount = votes[bestDate];

  if (bestCount === total) {
    // Unanimous
    const score = Math.max(0, 4 - deterministicCompetingPoints);
    return { date: bestDate, score, label: 'llm-consensus', votes };
  } else if (bestCount > total / 2) {
    // Simple majority
    return { date: bestDate, score: 1, label: 'llm-majority', votes };
  } else {
    // No majority
    return { date: null, score: 0, label: 'llm-split', votes };
  }
}
```

**Integration in processPage:**

Replace the single LLM call block with:

```javascript
// [2] LLM multi-vote date extraction (5 parallel calls)
const today = new Date().toISOString().substring(0, 10);
const dateText = extracted.rawText || extracted.markdown;
const snippet = dateText.substring(0, 2000);
const datePrompt = `Today's date is ${today}. Extract the primary publication or start date from this article/page snippet. Return ONLY the date in ISO format YYYY-MM-DD, or the word null if no date is present.\n\n${snippet}`;

const NUM_VOTES = 5;
const llmResults = await Promise.all(
  Array.from({ length: NUM_VOTES }, () =>
    generateTextWithCustomPrompt(pool, datePrompt)
      .then(r => (r.response || '').trim().replace(/^["']|["']$/g, ''))
      .catch(() => null)
  )
);
const parsedResults = llmResults.map(r => /^\d{4}-\d{2}-\d{2}$/.test(r) ? r : null);
```

Then after deterministic sources are scored, compute competing points and call `scoreLlmConsensus`:

```javascript
// Sum deterministic points for dates that don't match LLM consensus
const prelimConsensus = scoreLlmConsensus(parsedResults, 0);
let competingPoints = 0;
if (prelimConsensus.date) {
  for (const [date, score] of Object.entries(deterministicScores)) {
    if (date !== prelimConsensus.date) competingPoints += score;
  }
}
const llmVote = scoreLlmConsensus(parsedResults, competingPoints);

// Add to consensus scoring
if (llmVote.date && llmVote.score > 0) {
  add(llmVote.date, llmVote.score, llmVote.label);
}
```

**Logging:** Log the vote distribution for debugging:

```
Phase II: [Dates] 2026-02-09 (score=4, sources={"2026-02-09":["llm-consensus(5/5)","time-tag"]}) from https://...
```

---

### Fix 3: Expand URL Date Pattern Extraction

**File:** `backend/services/dateExtractor.js` (extractUrlDate function)

**Problem:** `extractUrlDate()` only matches `/YYYY/MM/DD/` patterns. Misses:
- NPS: `/news/20250929-article-name.htm` (YYYYMMDD in slug)
- ANPR: `/release/2026/0109` (YYYY/MMDD without separator)

**Change:** Add additional patterns after the existing `/YYYY/MM/DD/` match:

```javascript
export function extractUrlDate(url) {
  if (!url) return null;
  let path;
  try { path = new URL(url).pathname; } catch { path = url; }

  // Pattern 1: /YYYY/MM/DD/ (existing)
  const match1 = path.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
  if (match1) {
    const [, y, m, d] = match1;
    const year = parseInt(y), month = parseInt(m), day = parseInt(d);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${y}-${m}-${d}`;
  }

  // Pattern 2: YYYYMMDD in path segment (e.g., /news/20250929-article-name)
  const match2 = path.match(/\/(\d{4})(\d{2})(\d{2})[^\/\d]/);
  if (match2) {
    const [, y, m, d] = match2;
    const year = parseInt(y), month = parseInt(m), day = parseInt(d);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${y}-${m}-${d}`;
  }

  // Pattern 3: /YYYY/MMDD (e.g., /release/2026/0109)
  const match3 = path.match(/\/(\d{4})\/(\d{2})(\d{2})(?:\/|$)/);
  if (match3) {
    const [, y, m, d] = match3;
    const year = parseInt(y), month = parseInt(m), day = parseInt(d);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${y}-${m}-${d}`;
  }

  return null;
}
```

**Impact:** ~6 items gain 1 URL point (nps.gov: 4, anpr.org: 2). Combined with LLM consensus, these reach 5 pts.

---

### Fix 4: Instagram URL Normalization

**File:** `backend/services/contentExtractor.js` or `backend/services/newsService.js` (before URL rendering)

**Problem:** Instagram `/reel/` and `/reels/` URLs serve less structured metadata than `/p/` URLs. The `/p/` form reliably exposes `<time datetime>` elements.

**Change:** Normalize Instagram URLs before rendering:

```javascript
function normalizeSourceUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('instagram.com')) {
      // /reel/ID/ or /reels/ID/ → /p/ID/
      parsed.pathname = parsed.pathname.replace(/^\/(reels?)\//,'/p/');
      return parsed.toString();
    }
    return url;
  } catch { return url; }
}
```

Apply before `extractPageContent()` calls and store the original URL as `source_url` (do not overwrite — this is for rendering only).

**Impact:** Future-proofing for Instagram content. Current items already have time-tags from `/reel/`, but `/p/` provides more reliable rendering.

---

## Scoring Summary

### Current Weights

| Source | Weight | Notes |
|--------|--------|-------|
| JSON-LD datePublished | 3 pts each | Most authoritative |
| LLM single call | 2 pts | Unreliable, hallucination-prone |
| Meta tags (OG, Parsely, DC) | 1 pt each | CMS-editable |
| HTML `<time datetime>` | 1 pt each | Structural |
| URL path date | 1 pt | Static |

### New Weights

| Source | Weight | Notes |
|--------|--------|-------|
| JSON-LD datePublished | 3 pts each | Unchanged |
| **LLM 5-vote unanimous** | **4 pts (minus competing deterministic)** | **Replaces single LLM call** |
| **LLM 3-4/5 majority** | **1 pt** | **New: weak signal** |
| **LLM no majority** | **0 pts** | **New: discarded** |
| Meta tags (OG, Parsely, DC) | 1 pt each | Unchanged |
| HTML `<time datetime>` | 1 pt each | Unchanged |
| URL path date | 1 pt | Unchanged, patterns expanded |

### Auto-Approve Threshold

Unchanged at **4 pts**.

---

## Expected Impact on Current Queue (56 pending items)

| Outcome | Count | Examples |
|---------|-------|---------|
| Auto-approve (reaches 4+) | ~41 | appalachianadv, clevelandmetroparks, conservancyforcvnp, norfolksouthern, nps.gov, anpr.org, cvsr.org, akronohio.gov |
| Stays pending (structural disagreement) | ~7 | Instagram (3), Reddit, X/Twitter, Spring Fling, Wikipedia (denied) |
| Stays pending (no dates) | 4 | clevelandorchestra, nps.gov/safety, youtube, conservancy sponsor-an-acre |
| Stays pending (LLM splits on year) | ~4 | Past events with no year specified |

---

## Non-Functional Requirements

**NFR-001: Cost**
- 5x Gemini Flash calls per URL (replaces 1x). Each call sends ~2000 chars of page content (~600 tokens input, ~10 tokens output). Total: ~3000 input tokens per item.
- At $0.075/1M input tokens: ~$0.0002 per item. For ~250 POIs per collection (organizations and points only), each yielding multiple URLs: ~$0.10-0.15 per full collection run.
- Calls run in parallel — no latency increase.

**NFR-002: Observability**
- Log vote distribution: `llm-consensus(5/5)`, `llm-majority(3/5)`, `llm-split(2/3)`
- Log competing deterministic penalty when applied

**NFR-003: Backward Compatibility**
- Items already in the database retain their existing `date_consensus_score`
- New scoring applies only to newly collected items and items requeued for moderation

---

### Fix 5: Unified Scoring in processItem

**Files:** `backend/services/moderationService.js` (processItem + fixDate)

**Problem:** Three separate code paths extract and score dates independently:

| Path | When | How | Score |
|------|------|-----|-------|
| `processPage` (collection) | News/event first collected | Full consensus pipeline | Computed |
| `processItem` (moderation sweep) | Sweep picks up unprocessed items | Reads existing score, applies threshold | Passthrough |
| `fixDate` (admin action) | Admin clicks "Fix Date" | chrono-node → single Gemini call | Hardcoded 6 |

`processItem` doesn't re-score — it just checks the existing `date_consensus_score` against threshold. `fixDate` has its own pipeline that bypasses consensus entirely and hardcodes score 6.

**Change:** Make `processItem` the single scoring authority for news/events:

1. **Check existing score** — if `date_consensus_score >= threshold`, skip to step 6 (already scored during collection, no re-render needed)
2. **Render** the source URL via `extractPageContent()` (Playwright + Readability)
3. **Extract deterministic sources** from rendered page (JSON-LD without dateModified, meta tags, `<time>` elements, URL date patterns)
4. **Run LLM multi-vote** (5 parallel calls with date seeding)
5. **Score** using `scoreDateConsensus()` + `scoreLlmConsensus()` with competing deterministic penalty
6. **Apply threshold** — auto-approve if score >= 4, else pending
7. **Update DB** with `publication_date`, `date_consensus_score`, `moderation_status`, `moderation_processed = true`

**`fixDate` becomes a thin wrapper:** Instead of its own extraction pipeline, `fixDate` simply requeues the item (`moderation_processed = false`) and lets the next moderation sweep run `processItem` on it. Or it calls `processItem` directly. Either way, one pipeline, one set of scoring rules.

**Impact:**
- Every item — whether newly collected, swept, or admin-fixed — goes through the same consensus scoring
- No more hardcoded score 6
- No more chrono-node `findPublicationDate()` in the moderation path (was too noisy)
- Requeuing pending items after deploy actually works — `processItem` will re-render and re-score them

**Cost tradeoff:** `processItem` now renders pages (Playwright) and makes 5 LLM calls per item. This is heavier than the old passthrough, but the moderation sweep is rate-limited to 20 items per run and runs every 15 minutes. At ~30 seconds per item (render + 5 parallel LLM calls), a batch of 20 takes ~10 minutes. Acceptable.

**Relationship to collection pipeline:** `processPage` in `newsService.js` continues to score dates during collection (it already has the rendered page content — no point re-rendering). Both `processPage` and `processItem` call the same shared scoring functions (`scoreDateConsensus`, `scoreLlmConsensus`, `extractUrlDate`, etc.) from `dateExtractor.js`. The architecture:

```
Shared scoring functions (dateExtractor.js)
  ├── scoreDateConsensus()      — deterministic source scoring
  ├── scoreLlmConsensus()       — multi-vote LLM scoring (NEW)
  ├── extractUrlDate()          — URL pattern extraction (UPDATED)
  └── normalizeDateSources()    — source normalization

Collection path (newsService.js → processPage)
  → extractPageContent() → extract sources → score → save with score
  → processItem() just applies threshold (item already scored)

Moderation rescore path (moderationService.js → processItem)
  → extractPageContent() → extract sources → score → update score → apply threshold

Both paths use identical scoring functions. One codebase, two entry points.
```

---

## Open Questions

1. ~~Should `llm-consensus` replace or augment the single LLM call?~~ **Decided: Replace.**
2. Should the event date extraction prompt also use multi-vote? (Currently a separate prompt that extracts start/end datetime as JSON.) Cost is higher per call since the prompt is larger.
3. ~~Duplicate URLs are never re-collected. How to rescore existing items?~~ **Decided: Requeue all pending items after deploy.**

**Important:** The current `processItem` function just reads the existing `date_consensus_score` and applies the threshold — it does NOT re-extract dates. Simply resetting `moderation_processed = false` would re-run the threshold check on stale scores. Useless.

**Required change:** Modify `processItem` for news/events so that when `date_consensus_score < threshold`, it runs the full consensus pipeline (render page, extract structural sources, LLM multi-vote) before deciding. This means the moderation sweep becomes the single path for scoring — both new items from collection and requeued items go through the same logic.

After deploy, run the one-time migration:

```sql
UPDATE poi_news SET moderation_processed = false WHERE moderation_status = 'pending';
UPDATE poi_events SET moderation_processed = false WHERE moderation_status = 'pending';
```

The next moderation sweep (runs every 15 minutes) will pick them up, re-score with the new pipeline, and auto-approve items that now reach threshold.

---

## Test Plan

- [ ] Verify `dateModified` removal: Davey Tree page scores 2025-01-21 (not 2025-10-21)
- [ ] Verify LLM consensus on clear date: clevelandmetroparks "February 09, 2026" → 5/5 unanimous
- [ ] Verify LLM consensus on ambiguous date: CVSR Spring Fling → split vote, scored 0-1
- [ ] Verify competing deterministic penalty: Instagram Hampton Hills → LLM date penalized, time-tag date wins
- [ ] Verify URL date extraction: nps.gov `/20250929-` → extracts 2025-09-29
- [ ] Verify URL date extraction: anpr.org `/2026/0109` → extracts 2026-01-09
- [ ] Verify Instagram URL normalization: `/reel/ID` → `/p/ID` before rendering
- [ ] Verify no regression: items that currently auto-approve (score >= 4) still auto-approve
- [ ] Run full collection on test POI and verify scoring logs

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-04-19 | Initial draft from moderation queue analysis |
