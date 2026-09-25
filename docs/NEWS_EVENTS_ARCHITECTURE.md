# News & Events Collection Architecture

## The Problem

Roots of The Valley tracks about 770 points of interest (POIs) across the Cuyahoga Valley region. Their news, events, history, and announcements are scattered across park district sites, local news outlets, social media, and small organizations' pages built on every framework there is. The pipeline discovers that content, extracts one item per story or event, dates it, moderates it, and publishes it to POI pages, the `/news` and events views, and the Friday newsletter.

## Three Jobs

Collection runs as three purpose jobs, shown separately in the admin Jobs tab (spec 044). They replaced the old "News & Events Daily/Weekly/Monthly" tier jobs.

| Job | Schedule (ET) | POIs | What it does |
|-----|---------------|------|--------------|
| **Events** | daily 04:30 | POIs with an `events_url` | Crawls each events page (Phase I). No search. |
| **Current News** | daily 06:00 | POIs whose tier cadence is due | Crawls the POI's `news_url` (Phase I), then searches Google News for the past month (Phase II). |
| **Historical News** | monthly, the 15th, 02:00 | POIs whose history search hasn't run dry | Web search for the POI's history, a few URLs per run. No Phase I. |

**Tier is a cadence, not a job.** `pois.collection_tier` (`daily`, `weekly`, `monthly`) says how often Current News checks a POI. A POI is due when `last_current_news_collection` is older than about 1, 7, or 30 days (a couple of hours short, so scheduler jitter never skips a day). See `isDueForCurrentNews` in `backend/services/newsPipelines.js`.

Schedules are registered in `backend/server.js` (`schedulePipelineCollection`); job metadata for the Jobs tab lives in `backend/services/collection/registry.js`. All three write to `news_job_status` with `pipeline` set to `current_news`, `historical_news`, or `events`.

## Current News vs Historical News

Both pipelines use the same crawl, render, and extraction machinery. Everything that differs lives in `backend/services/newsPipelines.js`.

| | Current News | Historical News |
|---|---|---|
| Purpose | What is happening now | The story of the place |
| Search | Serper `/news`, `tbs: qdr:m`, query `"{POI}" {boundaries}` | Serper `/search`, no date filter, rotating query (`history of {POI}`, `{POI} historic`, `{POI} archives photos`) |
| URLs per run | `max_search_urls` | `news_history_max_urls` (default 3) |
| Extraction prompt | What happened or is changing, and what it means for visitors | The interesting history the page tells, with `story_year` if stated |
| Relevance criteria | Reports of something that happened or changed. Rejects evergreen guides, trip reports, social recaps | Content about the place's past. Rejects trip reports and reviews with no history |
| Date gate | Required (see Moderation) | Not required; the date only orders items |
| Published to | POI pages, `/news`, notifications, newsletter | POI pages only, labeled "History" |

**Labels come from age, not from the search.** When an item is saved, `newsPipelineFor()` sets `poi_news.pipeline`: an item published within `news_current_window_days` (default 30) of when it was found is `current`; older or undated items are `historical`. A Google News hit can be old and a web-search hit can be fresh, so the search that found it doesn't decide.

**Historical News stops on its own.** After each POI, if the search returned no URL that isn't already in `poi_news`, `pois.history_dry_runs` increments; otherwise it resets to 0. At `news_history_dry_run_limit` (default 3) the POI is skipped. The query angle rotates every run (`history_query_index`). Reset one POI or all with `POST /api/admin/news/historical/reset`.

Why the split: before it, 411 of the 603 news items published in a 30-day window were already more than 90 days old. History was deliberately collected, but it arrived through the same path as news and crowded it out.

## The Pipeline

```
URL → [Render/Cache] → [Classify] → [ItemCount] → [Extract] → [Venue] → [Dates] → [Save] → [Moderate]
```

- **Render** — `renderPage` (`renderPage.js`) wraps `extractPageContent` (`contentExtractor.js`: Playwright, Readability → markdown, plus `rawText`, meta/og dates, JSON-LD dates and Event nodes, links). Results are cached in `rendered_page_cache`: detail pages forever, listings 23 hours, trail status 25 minutes.
- **Classify** — Gemini decides listing / detail / neither (`classifyPage`). Listings are followed to detail pages within the POI's path or domain, or paths in `trusted_content_paths`.
- **Skip known** — detail URLs already in `poi_news`/`poi_events` are skipped (`filterKnownPages`).
- **ItemCount + Extract** — Gemini counts items on the page, then extracts each one: `buildEventPrompt` for events, `buildNewsPrompt(pipeline, …)` for news.
- **Venue (events)** — schema.org JSON-LD `Event.location` wins over the model's `location_details` (`eventVenue.js`). The model only sees the Readability markdown, which on some sites drops the venue block and keeps a contact line ("call the Nature Realm Visitors Center"). The model's text survives when it already names the same street number and street as the JSON-LD address, or when the page has no JSON-LD.
- **Dates** — see below.
- **Save** — `saveNewsItems` / `saveEventItems` dedupe by normalized URL (any POI) and by normalized title within the POI (events: plus the same Eastern calendar day). A duplicate with a new URL is merged into `poi_news_urls` / `poi_event_urls`. Items are saved as `pending`.

**Snippet recovery.** When a search result can't be rendered (paywall, WAF, login wall) but has a title, snippet, and date, the item is saved from the snippet with `from_snippet = true`. Current News snippet items never auto-publish; they wait in the moderation queue.

## Dates

`scoreDate` (`newsService.js`) combines deterministic signals with four LLM votes and picks the date with the highest total (`scoreDateConsensus`, `dateExtractor.js`). A tie scores 0.

| Signal | Weight |
|--------|--------|
| JSON-LD (`datePublished`, `startDate`, …) | 4 |
| Search-engine date (Serper) | 4 |
| Social post timestamp (Facebook/Instagram) | 4 |
| Meta tags, `<time>` tags, URL date | 1 each |
| LLM vote (4 persona voters) | 1 each |

News gets one date; events get start and end. Date-only values are stored at noon Eastern so no US timezone shifts the calendar day.

## Moderation

A sweep (`processPendingItems`, `moderationService.js`) runs every 15 minutes and on demand. Each item passes through, in order:

1. **Duplicate** — same normalized title already published for the same POI (events: same Eastern day) → rejected.
2. **Source URL** — news, and AI events, must have one.
3. **Deny lists** — POI and content deny lists (`filterLists.js`) → rejected.
4. Four gates; all must pass to auto-publish:
   - **Date** (spec 030) — present, not in a future Eastern calendar day (news), year ≥ `moderation_date_floor_year`, consensus score ≥ threshold (4, or the POI's own threshold for items from its configured URL). Historical News skips this gate.
   - **Relevance** — 3 votes on title + summary with the pipeline's criteria (events use the shared criteria). 3/3 → pass, 0-1/3 → reject, 2/3 → review. For events, a vote counts if the item is relevant **or** about the POI; for news, only relevance counts.
   - **Region** (spec 041) — 3 votes on whether the subject is physically in Northeast Ohio. Unanimous out → reject.
   - **POI** — about the assigned POI (Tier 1), or reassigned to its owner organization or containing boundary (Tier 2), else review.

Everything else stays `pending` for a human. **Fix Date** (`fixDate`) rescores from the stored `date_signals` (events read the `start` signals), or re-renders the page if there are none, and never erases an existing date.

## Newsletter

The Friday digest (`newsletterDigestService.js`) is built from live data at send time. The Thursday preview uses the same query as of Friday.

- **Events** — Friday through Sunday (Eastern), published, deduplicated by POI + title + day. Each shows `venue · organizer` from `location_details` and the POI name.
- **News** — Current News only, collected in the 7 days before the send, excluding social and aggregator hosts, deduplicated two ways: same POI with mostly overlapping title and summary vocabulary, and the same outlet covering one story twice within 48 hours (headlines sharing at least 4 significant words), regardless of POI. The fuller summary wins.
- **Greeting** — `admin_settings.digest_greeting`.

## Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `max_concurrency` | 10 | POIs processed in parallel per job |
| `max_search_urls` | 10 | Serper results requested; Current News URLs crawled per POI |
| `page_concurrency` / `page_delay_ms` | 3 / 2000 | Detail-page parallelism and stagger within a POI |
| `news_current_window_days` | 30 | Age limit for Current News |
| `news_history_max_urls` | 3 | Historical News URLs crawled per POI per run |
| `news_history_dry_run_limit` | 3 | Consecutive dry runs before Historical News skips a POI |
| `moderation_news_date_threshold` | 4 | Date-gate consensus threshold |
| `moderation_date_floor_year` | 2010 | Earliest plausible date |
| `news_collection_excluded_pois` / `_types` | — | POIs and amenity types never collected |

## Key Files

| File | Purpose |
|------|---------|
| `backend/services/newsPipelines.js` | Current vs Historical: labels, cadence, search requests, prompts, relevance criteria |
| `backend/services/newsService.js` | `collectPoi`, `crawlPage`, `processPage`, dates, save, job orchestration, `getPoisForPipeline` |
| `backend/services/serperService.js` | Serper search with PostGIS geographic grounding |
| `backend/services/contentExtractor.js` / `renderPage.js` | Playwright extraction and the render cache |
| `backend/services/eventVenue.js` | JSON-LD event venues |
| `backend/services/dateExtractor.js` | Date parsing and consensus scoring |
| `backend/services/moderationService.js` | Moderation gates, sweep, queue, Fix Date |
| `backend/services/newsletterDigestService.js` | Digest selection, dedup, rendering, send |
| `backend/services/collection/registry.js` | Jobs tab registry |
| `backend/migrations/089_news_pipelines.sql` | Pipeline columns, per-POI state, settings |
