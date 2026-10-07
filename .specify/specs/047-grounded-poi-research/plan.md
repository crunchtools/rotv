# Implementation Plan: POI research from fetched pages

> **Spec ID:** 047-grounded-poi-research
> **Status:** Implemented
> **Last Updated:** 2026-10-06

## Summary

The route gathers pages, the LLM function extracts from them. `backend/services/researchSources.js` is the research counterpart of news Phase II without the classify, date and save steps: it returns text. `llmService.js` stays free of Playwright and takes the gathered pages as an argument. The endpoint stays synchronous; parallel renders (25s hard cap) and concurrent passes keep the wait near one LLM call.

## Changes by file

| File | Change |
|------|--------|
| `backend/services/newsPipelines.js` | `serperRequestFor('research', …)`: web search, quoted name plus boundaries |
| `backend/services/serperService.js` | Docs and log wording for the research request |
| `backend/services/researchSources.js` | New: `gatherResearchSources`, skip rules, render, text budget |
| `backend/services/moderationService.js` | `isSafePublicUrl` exported for the skip rules |
| `backend/services/llmService.js` | Prompts take numbered sources and cite by number; `resolveCitedSources`; `researchLocationMultiPass` takes `gathered`, returns early with a notice on no sources, runs both passes concurrently, logs stage timings; smaller reasoning and output budgets |
| `backend/routes/admin.js` | `/ai/research-v2` gathers sources before the LLM call |
| `frontend/src/components/sidebar/EditView.jsx`, `App.css` | Draft modal: notice, sources cited, pages read, could not read |
| `backend/services/collection/registry.js` | Research job description |

## Testing

- `backend/tests/researchSources.unit.test.js`: order and numbering, dedup against the reference page, skip rules, page cap, unreachable pages, text fallback and truncation, search outage, missing key
- `backend/tests/llmService.unit.test.js`: sources in both prompts, citations resolved to fetched URLs only, no model call without sources, history dropped when pass 1 is empty, budgets
- `backend/tests/newsPipelines.unit.test.js`, `backend/tests/serperService.unit.test.js`: the research request
- `frontend/src/components/sidebar/EditView.test.jsx`: notice and page lists in the modal
- Manual: research Cascade Locks Park (5508) and an obscure POI; stage timings appear in the Jobs tab under POI Research

## Risks

| Risk | Mitigation |
|------|------------|
| The request runs longer than the model call alone | Renders are parallel, capped at 25s and usually cached; passes are concurrent. If prod timings stay high, move to the `news_single` async job pattern |
| Thin sources give thinner drafts than memory did | Intended: a null is correct, an unverified fact is not |
