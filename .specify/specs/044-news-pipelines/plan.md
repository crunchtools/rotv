# Implementation Plan: Current News and Historical News Pipelines

> **Spec ID:** 044-news-pipelines
> **Status:** Implemented
> **Last Updated:** 2026-09-25

## Summary

Everything that differs between the pipelines lives in one module, `backend/services/newsPipelines.js`: the age rule (`newsPipelineFor`), the Current News cadence (`isDueForCurrentNews`), the Serper request (`serperRequestFor`), the extraction prompt (`buildNewsPrompt`), and the relevance criteria (`newsRelevanceCriteria`). The rest of the pipeline takes a `pipeline` option and asks it.

## Changes by file

| File | Change |
|------|--------|
| `backend/migrations/089_news_pipelines.sql`, `backend/server.js` initDatabase | Columns, settings, backfill (age rule; `from_snippet` where `rendered_content = summary`), requeue of same-day items stranded as "future" |
| `backend/services/newsPipelines.js` | New: pipeline rules and prompts |
| `backend/services/serperService.js` | One endpoint per pipeline; `tbs` for Current News; rotating history query |
| `backend/services/newsService.js` | `collectPoi({ pipeline })` (Historical skips Phase I, caps URLs, reports `freshUrlCount`); save labels `pipeline`, `from_snippet`, `story_year`; `getPoisForPipeline`, `runPipelineCollection`, `recordPipelineRun`; jobs carry `pipeline` |
| `backend/services/jobScheduler.js`, `backend/server.js` | Three pipeline schedules; tier schedules unscheduled on boot |
| `backend/services/moderationService.js` | Pipeline relevance criteria; news votes count relevance only; Historical skips the date gate; Current snippet items held; `rescoreFromSignals` (events use `start`); Eastern-day future check; dedup scoped to POI |
| `backend/services/newsletterDigestService.js` | Current News collected in the prior 7 days |
| `backend/server.js`, `backend/routes/notifications.js` | `/api/news/recent` and notifications: Current only; POI news returns `pipeline`, `story_year`, current first |
| `backend/routes/admin.js`, `backend/services/mcpServer.js` | Pipeline trigger, status, AI stats, history `subtype`, per-pipeline last run, history reset, MCP trigger |
| `backend/services/collection/registry.js`, `frontend/src/components/JobsDashboard.jsx` | Three jobs replace the tier jobs |
| `frontend/src/components/sidebar/PoiNews.jsx`, `App.css` | "History · year" label |

## Testing

- `backend/tests/newsPipelines.unit.test.js`: age rule, cadence, Serper requests, prompts
- `backend/tests/serperService.unit.test.js`: request body per pipeline, query rotation
- `backend/tests/services/moderationService.test.js`: same-day date gate, `rescoreFromSignals`
