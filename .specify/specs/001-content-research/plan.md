# Implementation Plan: Content Research

> **Spec ID:** 001-content-research
> **Status:** Complete
> **Last Updated:** 2026-03-28
> **Estimated Effort:** S

## Summary

Add a `researchItem()` function to moderationService.js that uses Gemini 2.5 Flash with Google Search grounding to find correct URLs for broken news/event items. Expose via API endpoint, frontend button, and MCP tool. No new files — 4 existing files modified.

---

## Architecture

### Data Flow

1. User clicks Research button (or calls MCP tool)
2. Backend fetches item data from DB (title, description, poi_name, source_url)
3. Gemini with Google Search grounding searches the web for the specific page
4. If a better URL is found, the item's source_url is updated in the DB
5. Item is requeued (score/reasoning cleared) and a moderation job is queued
6. Moderation sweep re-processes the item with the new data

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| AI Search | Gemini 2.5 Flash + Google Search grounding | Same pattern as `researchLocation()` in geminiService.js |
| JSON parsing | Manual brace-counting parser | Same pattern used throughout geminiService.js for handling markdown-wrapped JSON |

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/moderationService.js` | Import `createGeminiClient`, add `researchItem()` function |
| `backend/routes/admin.js` | Import `researchItem`, add `POST /moderation/research` route |
| `frontend/src/components/ModerationInbox.jsx` | Add `researchingItem` state, `handleResearch()`, Research button in pending/non-pending areas |
| `backend/services/mcpServer.js` | Import `researchItem` + `queueModerationJob`, add `queue_research` tool |

---

## Testing Strategy

### Manual Testing

1. Open moderation queue, find a pending item with a bad/missing URL
2. Click Research — verify "Researching..." state, then notification
3. Check item was updated (new URL if found) and requeued to pending
4. Verify Research button does NOT appear for photo items
5. Test with a rejected item via the Rejected filter
6. Test via MCP: call `queue_research` with a known news/event ID
7. `./run.sh test` — all existing tests pass

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gemini returns wrong URL | Med | URL is just a suggestion — item goes through full moderation after research |
| API key not configured | Low | `createGeminiClient()` already throws a clear error |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-03-28 | Initial plan and implementation |
