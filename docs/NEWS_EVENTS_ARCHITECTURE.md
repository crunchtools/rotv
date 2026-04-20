# News & Events Collection Architecture

## The Problem

Roots of The Valley tracks hundreds of Points of Interest (POIs) across the Cuyahoga Valley region. Each POI may have news articles, upcoming events, trail alerts, and community announcements spread across dozens of websites. These websites use every framework imaginable — Wix, Squarespace, WordPress, React SPAs, plain HTML — making traditional scraping unreliable. Manually maintaining content for hundreds of destinations is impractical.

The system solves this with an automated pipeline that discovers, renders, classifies, crawls, date-stamps, summarizes, moderates, and saves content — with clear separation of responsibilities between tools.

## Pipeline Architecture

The pipeline is **per-item** — every news article or event gets its own summarization and date scoring. There is no batching or concatenation of content across items.

```
URL  →  [Render/Cache]  →  [Classify]  →  [ItemCount]  →  [Summarize]  →  [Dates]  →  [Save]
        renderPage          Gemini         Gemini          Gemini          scoreDate    PostgreSQL
```

Every item produced by `[Summarize]` has `source_url` set to the URL that was rendered. This is deterministic — no guessing, no cross-page attribution.

### The Core Function: `processPage`

Takes a pre-rendered page object (from `crawlPage`), counts items, then loops: summarize each item individually and score its dates. No Playwright call — works entirely from cached content.

```
processPage(pool, page, poi, contentType, options)
  page = { url, markdown, rawText, ogDates, title }

  1. itemCount(pool, markdown, contentType)  → N items on page
  2. For each item 1..N:
     a. buildEventPrompt or buildNewsPrompt → Gemini → single item JSON
     b. scoreDate per item (5-vote LLM + deterministic sources)
     c. Attach source_url, rendered_content, date_signals
  3. Return { news: [], events: [] }
```

### Render Cache

All page rendering goes through `renderPage(pool, url, options)`, a cached wrapper around `extractPageContent` (Playwright). Results are stored in the `rendered_page_cache` table keyed by URL.

TTL by page type:
- **detail** — cached forever (article/event pages don't change)
- **listing** — 23 hours (listing pages add new items over time)
- **trail_status** — 25 minutes (trail conditions change frequently)

`page_type` is set after classification via `setCachePageType()`. Trail status callers pass `pageType: 'trail_status'` upfront since they skip classification.

### Discovery vs. Processing

Discovery (finding and rendering URLs) is separate from processing (summarization + date scoring):

- **Phase I Discovery**: `crawlPage` renders the POI's dedicated pages via `renderPage`, classifies each as listing or detail, follows links on listing pages. Returns fully-extracted page objects from cache.
- **Phase II Discovery**: Serper API returns search result URLs. Each is crawled via `crawlPage` with the same cache-first rendering.
- **Processing**: Every discovered page goes through `processPage` — no re-rendering needed. Content comes from `rendered_page_cache`.

### The Stages

| Stage | Log Prefix | Tool | Responsibility |
|-------|-----------|------|----------------|
| **Search** | `[Search]` | Serper API | Find URLs for external coverage (Phase II only) |
| **Render** | `[Render]` | renderPage (Playwright + cache) | Render URL to markdown, cache result |
| **Cache** | `[Cache]` | PostgreSQL | Cache hit — skip Playwright |
| **Classify** | `[Classify]` | Google Gemini | Determine if a page is a listing or detail |
| **Crawl** | `[Crawl]` | renderPage | Follow links from listing pages |
| **ItemCount** | `[ItemCount]` | Google Gemini | Count distinct news/events on a page |
| **Summarize** | `[Summarize]` | Google Gemini | Extract single item from page |
| **Dates** | `[Dates]` | scoreDate (5-vote LLM + deterministic) | Score date per item |
| **Save** | `[Save]` | PostgreSQL | Deduplicate, normalize, persist |

### Key Design Principle: Tools Stay in Their Lane

- **Gemini never extracts dates.** Dates are scored separately via `scoreDate` using deterministic sources (JSON-LD, meta tags, `<time>` elements, URL patterns) plus LLM 5-vote consensus.
- **Gemini classifies pages, not content.** Classification asks "Is this page a listing or a detail page?" — it does not summarize or extract data.
- **Gemini summarizes, moderation filters.** Collection prompts extract what's on the page. Relevance filtering happens in the moderation sweep.
- **Serper never renders.** It returns URLs. `renderPage` renders them.
- **source_url is deterministic.** Every item's source_url is the URL that was rendered — forced after Gemini returns.

### Gemini's Four Roles

Gemini is used for four distinct tasks, each with a clear boundary:

1. **Classification** — "Is this page a listing or detail?" Called per-page during discovery. Returns a page type and links to follow.
2. **Item counting** — "How many distinct items are on this page?" Called per-page before summarization.
3. **Summarization** — "Summarize this single news/event." Called per-item via `buildNewsPrompt` or `buildEventPrompt`.
4. **Moderation** — "Is this item relevant and high-quality?" Called per-item during the separate moderation sweep.

### Date Scoring

One function (`scoreDate`) handles both news dates and event datetimes. News calls it once (mode `'date'`, returns `YYYY-MM-DD`). Events call it twice — once for start, once for end (mode `'datetime'`, returns `YYYY-MM-DDTHH:MM`).

Weights:
| Source | Weight |
|--------|--------|
| JSON-LD | 4 pts each |
| LLM 5/5 unanimous | 4 pts (minus competing deterministic) |
| LLM 3-4/5 majority | 1 pt |
| Meta tags | 1 pt each |
| `<time>` tags | 1 pt each |
| URL pattern | 1 pt |

## Two-Phase Collection

Content collection happens in two phases per POI. Logs show `Phase I:` or `Phase II:` prefix.

### Phase I: POI's Own Pages

If a POI has dedicated `events_url` or `news_url` configured:

1. **Render & Classify** the dedicated page using `crawlPage` — renders via `renderPage` (cache-first), classifies as listing or detail, follows links to detail pages.
2. Each detail page goes through `processPage` — itemCount, per-item summarize + date scoring.

POIs without dedicated URLs skip Phase I entirely.

### Phase II: External Coverage (Serper)

After Phase I, the system searches for external coverage:

1. **Search** via Serper API for news/events about the POI
2. For each Serper URL: crawl via `crawlPage`, then `processPage`
3. **Merge** with Phase I results, deduplicating by normalized title

## AI Moderation Pipeline

After collection saves items to the database, a separate moderation sweep scores each item for quality and relevance. The sweep runs every 15 minutes or can be triggered manually.

### What Moderation Does

- Renders the item's source URL via `renderPage` (uses cache if available)
- Sends the title, summary, and rendered content to Gemini for quality scoring
- Runs 3-vote relevance check: "Is this relevant to CVNP visitors?"
- Checks for issues: content not on source page, wrong POI, wrong geography, misclassified type, private content
- Applies domain reputation filters (trusted vs. competitor domains)
- Auto-approves items above the confidence threshold, rejects items below the floor, holds everything else for human review

### What Moderation Does NOT Do

- **Does not extract or overwrite dates.** Dates are set during collection by `scoreDate` and preserved through moderation.
- Does not re-summarize content. The summary from collection is kept.

### Fix Date (Manual Admin Action)

When an admin clicks "Fix Date" on a held item:

1. **Render** the source URL via `renderPage` (cache-first)
2. **scoreDate** rescores using deterministic sources + LLM 5-vote
3. Updated date and score are saved

## Job Execution

### Scheduling

- **Daily batch**: Runs at 6:00 AM Eastern via pg-boss cron, processing all POIs
- **Manual single-POI**: Admin triggers from the sidebar in edit mode
- **Manual batch**: Admin triggers from the Jobs dashboard for all POIs
- **Moderation sweep**: Runs every 15 minutes via pg-boss, or manually from the Jobs dashboard

### Batch Processing

- POIs are processed with staggered dispatch and limited concurrency
- pg-boss provides crash recovery — jobs survive container restarts
- Progress is checkpointed after each POI so interrupted jobs can resume
- Batch jobs can be cancelled at any time; in-flight POIs complete naturally

### Pipeline Settings (admin-configurable)

| Setting | Default | Description |
|---------|---------|-------------|
| `max_concurrency` | 10 | POIs processed in parallel per job |
| `max_search_urls` | 10 | Serper URLs crawled per POI in Phase II |
| `page_concurrency` | 3 | Detail pages processed in parallel within a POI |
| `page_delay_ms` | 2000 | Stagger between page processing dispatches |

## Deduplication Strategy

### During Collection (In-Memory)

Phase II results are deduplicated against Phase I results by normalized title before saving.

### At Save Time (Database)

- **URL matching**: Same resolved URL across any POI = same article.
- **Normalized title matching**: Strips date suffixes and compares titles within the same POI.

When a duplicate is detected with a different URL, the new URL is merged into the existing item's URL list.

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Search | Serper API | Web search and URL discovery |
| Rendering | Playwright + Chromium + Readability | JavaScript rendering and content extraction |
| Render cache | PostgreSQL (`rendered_page_cache`) | Cache rendered pages with TTL by page type |
| Classification | Google Gemini | Page type classification (listing/detail) |
| Item counting | Google Gemini | Count distinct items on a page |
| Dates | scoreDate (LLM 5-vote + deterministic) | Consensus date scoring for news and events |
| Summarization | Google Gemini | Per-item content extraction |
| Quality scoring | Google Gemini | AI-powered moderation with issue detection |
| Relevance voting | Google Gemini | 3-vote relevance check during moderation |
| Job queue | pg-boss | Crash-recoverable background job processing |
| Database | PostgreSQL | Content storage, deduplication, moderation state |
| Frontend | React | Real-time progress tracking, moderation inbox |

## Key Files

| File | Stage | Purpose |
|------|-------|---------|
| `backend/services/newsService.js` | All stages | `collectPoi`, `crawlPage`, `processPage`, `itemCount`, prompt builders |
| `backend/services/renderPage.js` | Render | Cached wrapper around `extractPageContent` with TTL |
| `backend/services/contentExtractor.js` | Render | Pure Playwright + Readability extraction (no DB) |
| `backend/services/dateExtractor.js` | Dates | `scoreDate`, `scoreDateConsensus`, `scoreLlmConsensus` |
| `backend/services/geminiService.js` | Summarize, Moderation | Gemini API client, `moderateContent`, `moderatePhoto` |
| `backend/services/moderationService.js` | Moderation | Quality scoring, relevance voting, Fix Date |
| `backend/services/serperService.js` | Search | Serper API integration |
| `backend/services/trailStatusService.js` | Trail Status | Trail condition extraction (separate pipeline) |
| `backend/services/collection/registry.js` | — | Collection type registry (schedules, triggers) |
| `frontend/src/components/JobsDashboard.jsx` | — | Job monitoring and log viewer |
| `frontend/src/components/ModerationInbox.jsx` | — | Moderation review interface |
