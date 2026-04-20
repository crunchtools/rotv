# News & Events Collection Architecture

## The Problem

Roots of The Valley tracks hundreds of Points of Interest (POIs) across the Cuyahoga Valley region. Each POI may have news articles, upcoming events, trail alerts, and community announcements spread across dozens of websites. These websites use every framework imaginable — Wix, Squarespace, WordPress, React SPAs, plain HTML — making traditional scraping unreliable. Manually maintaining content for hundreds of destinations is impractical.

The system solves this with an automated pipeline that discovers, renders, classifies, crawls, date-stamps, summarizes, moderates, and saves content — with clear separation of responsibilities between tools.

## Pipeline Architecture

The pipeline is **per-URL** — every URL gets its own complete pipeline run. There is no batching or concatenation of content across URLs.

```
URL  →  [Render]  →  [Dates]  →  [Summarize]  →  [Save]
        Playwright   chrono-node    Gemini        PostgreSQL
```

Every item produced by `[Summarize]` has `source_url` set to the URL that was rendered. This is deterministic — no guessing, no cross-page attribution.

### The Core Function: `processPage`

Takes a pre-rendered page object (from `crawlPage`), extracts dates, sends the content to Gemini, forces `source_url` on every returned item. No Playwright call — works entirely from saved content.

```
processPage(pool, page, poi, contentType, options)
  page = { url, markdown, rawText, ogDates, title }
  → { news: [], events: [] }
```

### Discovery vs. Processing

Discovery (finding and rendering URLs) is separate from processing (dates + summarization):

- **Phase I Discovery**: `crawlPage` walks the POI's dedicated pages, classifying each as listing/detail/hybrid and following links. Returns fully-extracted page objects.
- **Phase II Discovery**: Serper API returns search result URLs. Each is crawled via `crawlPage` and returned as a page object.
- **Processing**: Every discovered page goes through `processPage` — no re-rendering needed.

### The Stages

| Stage | Log Prefix | Tool | Responsibility |
|-------|-----------|------|----------------|
| **Search** | `[Search]` | Serper API | Find URLs for external coverage (Phase II only) |
| **Classify** | `[Classify]` | Google Gemini | Determine if a page is a listing, detail, or hybrid (discovery only) |
| **Crawl** | `[Crawl]` | Playwright + Readability | Follow links from listing/hybrid pages (discovery only) |
| **Render** | `[Render]` | Playwright + Readability | Convert a URL to clean markdown |
| **Dates** | `[Dates]` | chrono-node | Extract and normalize dates from THIS page only |
| **Summarize** | `[Summarize]` | Google Gemini | Extract items from THIS page only, with source_url forced |
| **Save** | `[Save]` | PostgreSQL | Deduplicate, normalize, persist |

### Key Design Principle: Tools Stay in Their Lane

- **Gemini never extracts dates.** Dates are chrono-node's job. Gemini may pass through dates it sees in content, but chrono-node normalizes everything at the save chokepoint.
- **Gemini classifies pages, not content.** Classification asks "Is this page a listing or a detail page?" — it does not summarize or extract data.
- **chrono-node never summarizes.** It only finds and normalizes date references in text.
- **Serper never renders.** It returns URLs. Playwright renders them.
- **source_url is deterministic.** Every item's source_url is the URL that was rendered — forced after Gemini returns, not relying on Gemini to attribute URLs correctly.
- **Moderation never overwrites collection dates.** Dates are set during collection and preserved through moderation. The only exception is the manual "Fix Date" button, which uses chrono-node first and Gemini as a fallback.

### Gemini's Three Roles

Gemini is used for three distinct tasks, each with a clear boundary:

1. **Classification** — "Is this page a listing, detail, or hybrid?" Called per-page during discovery. Returns a page type and links to follow.
2. **Summarization** — "What news/events are on this page?" Called once per page via `processPage`. Returns structured JSON with items from that single page.
3. **Moderation** — "Is this item relevant and high-quality?" Called per-item during the separate moderation sweep. Returns a quality score.

## Two-Phase Collection

Content collection happens in two phases per POI. Logs always show `Phase I:` or `Phase II:` prefix so you can tell which phase a URL is in.

### Phase I: POI's Own Pages

If a POI has dedicated `events_url` or `news_url` configured:

1. **Classify & Crawl** the dedicated page using `crawlPage` — renders it, classifies as listing/detail/hybrid, follows links to detail pages. Each page is rendered once and the full extraction `{ url, markdown, rawText, ogDates, title }` is saved.
2. If classifier finds detail pages, each gets `processPage` with 75% confidence — no re-rendering
3. If classifier finds no detail pages, the listing URL itself gets `processPage` (fallback)
4. Each `processPage` call: Dates → Summarize → force source_url (render already done)

Phase I uses relaxed confidence thresholds (75%) because content on an organization's own events/news page is inherently relevant to that POI.

POIs without dedicated URLs skip Phase I entirely and go straight to Phase II.

### Phase II: External Coverage (Serper)

After Phase I, the system searches for external news coverage:

1. **Search** via Serper API for news about the POI
2. For each Serper URL: crawl via `crawlPage`, then `processPage` with 95% confidence
3. **Merge** with Phase I results, deduplicating by normalized title

Phase II uses strict confidence thresholds (95%) because external sources may mention a POI tangentially without being truly relevant.

### Why Per-URL, Not Batched

The previous architecture batched all rendered content into a single Gemini call per phase. This caused:

- **Date cross-contamination**: chrono-node ran on concatenated pages, mixing dates between articles
- **URL misattribution**: Gemini couldn't reliably attribute items to source URLs when seeing 9 articles at once
- **Non-deterministic source_url**: Items' source_url depended on Gemini guessing correctly

The per-URL approach trades more Gemini calls (~5-20 per POI instead of 2-3) for correctness: every item has a verified source_url, and dates come from the item's page only.

## AI Moderation Pipeline

After collection saves items to the database, a separate moderation sweep scores each item for quality and relevance. The sweep can be triggered manually from the Jobs dashboard or runs automatically on a schedule.

### What Moderation Does

- Renders the item's source URL via Playwright
- Sends the title, summary, and rendered content to Gemini for **quality scoring only** (not date extraction)
- Checks for issues: content not on source page, wrong POI, wrong geography, misclassified type, private content
- Applies domain reputation filters (trusted vs. competitor domains)
- Auto-approves items above the confidence threshold, rejects items below the floor, holds everything else for human review

### What Moderation Does NOT Do

- **Does not extract or overwrite dates.** Publication dates and event dates are set during collection by chrono-node and preserved through moderation.
- Does not re-summarize content. The summary from collection is kept.

### The "Unknown Date" Hold Rule

- **News items** with no publication date (unknown confidence) are held for human review regardless of quality score.
- **Events** with a `start_date` but no `publication_date` use `start_date` as a fallback — they are NOT held just because the publication date is missing.

### Fix Date (Manual Admin Action)

When an admin clicks "Fix Date" on a held item:

1. **Render** the source URL via Playwright
2. **chrono-node** scans the rendered content for dates (fast path, no API call)
3. If chrono-node finds a date, it's saved immediately as `exact` confidence
4. If chrono-node fails, **Gemini** is called as a fallback (the only place Gemini is used for date work)

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

### Real-Time Progress

The admin UI shows a per-POI log tree during collection. Each POI entry expands to show the pipeline stages as they execute, with the most recent POI auto-expanded. Logs are stored in the `job_logs` table and polled by the frontend.

## Deduplication Strategy

Content is deduplicated at two levels:

### During Collection (In-Memory)

Phase II results are deduplicated against Phase I results by normalized title before saving. This prevents the same article from being saved twice within a single collection run.

### At Save Time (Database)

- **URL matching**: Same resolved URL across any POI = same article. Catches the same content found through different search paths or different POIs.
- **Normalized title matching**: Strips date suffixes and compares titles within the same POI. Catches the same content with slightly different formatting.

When a duplicate is detected with a different URL, the new URL is merged into the existing item's URL list rather than creating a new entry.

## Content Filtering

| Filter | Applied At | Rule |
|--------|-----------|------|
| Staleness | Save | News older than 365 days is excluded (unless from a dedicated news page) |
| Past events | Save | Events whose end date has passed are skipped |
| Confidence | Summarize | Dedicated pages: 75% threshold. External sources: 95% threshold |
| URL resolution | Save | Items with unresolvable redirect URLs are discarded |
| Domain reputation | Moderation | Trusted domains get a score boost; competitor/scam domains get penalized |

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Search | Serper API | Web search and URL discovery |
| Rendering | Playwright + Chromium + Readability | JavaScript rendering and content extraction |
| Classification | Google Gemini | Page type classification (listing/detail/hybrid) |
| Dates | chrono-node | Deterministic date parsing and normalization |
| Summarization | Google Gemini | Per-URL content extraction and type classification |
| Quality scoring | Google Gemini | AI-powered moderation with issue detection |
| Job queue | pg-boss | Crash-recoverable background job processing |
| Database | PostgreSQL | Content storage, deduplication, moderation state |
| Frontend | React | Real-time progress tracking, moderation inbox |

## Key Files

| File | Stage | Purpose |
|------|-------|---------|
| `backend/services/newsService.js` | All stages | Main collection orchestrator, `processPage`, `buildSummarizePrompt` |
| `backend/services/dateExtractor.js` | Dates | chrono-node wrapper utilities |
| `backend/services/geminiService.js` | Summarize, Moderation | Gemini API integration and prompts |
| `backend/services/moderationService.js` | Moderation | Quality scoring, Fix Date, auto-approval |
| `backend/services/contentExtractor.js` | Render | Playwright + Readability pipeline |
| `backend/services/serperService.js` | Search | Serper API integration |
| `backend/services/collection/registry.js` | — | Collection type registry (schedules, triggers) |
| `frontend/src/components/JobsDashboard.jsx` | — | Job monitoring and log viewer |
| `frontend/src/components/ModerationInbox.jsx` | — | Moderation review interface |
