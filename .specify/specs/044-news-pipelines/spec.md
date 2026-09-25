# Specification: Current News and Historical News Pipelines

> **Spec ID:** 044-news-pipelines
> **Status:** Implemented
> **Version:** 1.0.0
> **Author:** Scott McCarty
> **Date:** 2026-09-25

## Overview

ROTV collected historic news on purpose while the site was new, through the same path as current news, with one search (Serper `/search` + `/news`, no date filter) and one set of prompts. The archive is now large, and history crowds out news: of 603 news items published in a 30-day window, 411 were already more than 90 days old. This spec splits news into two named pipelines, **Current News** and **Historical News**, each with its own search, prompts, and publish rules, and reorganizes collection into three purpose jobs (Current News, Historical News, Events) in place of the daily/weekly/monthly tier jobs.

---

## User Stories

**US-001: Current News is actually current**
> As a newsletter subscriber, I want the news section to contain only recent news so that it's worth reading every week.

Acceptance Criteria:
- [x] Current News searches Google News for the past month only (`tbs: qdr:m`)
- [x] Items are labeled `current` or `historical` by age when found (window: `news_current_window_days`, default 30); undated items are historical
- [x] The newsletter, `/news` page, and notifications feed draw only from Current News
- [x] Current News relevance rejects evergreen guides, trip reports, and social recaps
- [x] Current News items built from a search snippet go to human review instead of auto-publishing

**US-002: Historical News keeps growing the archive, slowly**
> As the site owner, I want ROTV to keep finding history about each place without spending the daily budget on it.

Acceptance Criteria:
- [x] Historical News runs monthly with a rotating history query and at most `news_history_max_urls` (3) URLs per POI
- [x] A POI is skipped after `news_history_dry_run_limit` (3) runs in a row find no new URL; admins can reset it
- [x] The extraction prompt asks for the story and its year (`story_year`); the date gate does not apply
- [x] Historical items publish to POI pages with a "History" label and never reach the newsletter

**US-003: Jobs tab shows what runs**
> As an admin, I want collection jobs named for what they do so I can see and trigger each one.

Acceptance Criteria:
- [x] Jobs tab shows Current News, Historical News, and Events, each with its own status, history, and trigger
- [x] Tier (`daily`/`weekly`/`monthly`) is a per-POI cadence for Current News, not a job
- [x] Events collects only POIs with an `events_url`
- [x] The unused "News Collection Prompt" setting is removed

**US-004: Moderation bug fixes**
- [x] Fix Date on an event rescores from its `start` signals instead of erasing the date
- [x] Same-day news (stored at noon Eastern) is not treated as a future date
- [x] The duplicate check only rejects a title already published for the same POI (events: same Eastern day)

---

## Data Model

Migration `089_news_pipelines.sql` (idempotent; runs on every boot):

```sql
ALTER TABLE poi_news ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'current';  -- 'current' | 'historical'
ALTER TABLE poi_news ADD COLUMN from_snippet BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE poi_news ADD COLUMN story_year INTEGER;
ALTER TABLE pois ADD COLUMN last_current_news_collection TIMESTAMPTZ;
ALTER TABLE pois ADD COLUMN last_historical_collection TIMESTAMPTZ;
ALTER TABLE pois ADD COLUMN history_dry_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pois ADD COLUMN history_query_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE news_job_status ADD COLUMN pipeline TEXT;  -- current_news | historical_news | events
```

Settings: `news_current_window_days` (30), `news_history_max_urls` (3), `news_history_dry_run_limit` (3).

---

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/admin/news/collect?pipeline=current_news\|historical_news\|events` | Trigger a pipeline job | Admin |
| GET | `/api/admin/news/status?pipeline=…` | Latest run of one pipeline | Admin |
| POST | `/api/admin/news/historical/reset` | Reset Historical News dry runs (`{ poiId }` or all) | Admin |
| GET | `/api/pois/:id/news` | Now returns `pipeline` and `story_year` | No |
| GET | `/api/news/recent` | Current News only | No |

MCP `trigger_collection` accepts `current_news`, `historical_news`, `events`, `news` (legacy), `trail_status`.
