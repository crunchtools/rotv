# Specification: Content Research ("Look it up again")

> **Spec ID:** 001-content-research
> **Status:** Implemented
> **Version:** 1.0.0
> **Author:** Scott McCarty
> **Date:** 2026-03-28

## Overview

When reviewing pending or rejected content in the moderation queue, promising events or news items often have problems — missing URLs, broken URLs, or incomplete data. The existing Requeue button only clears the moderation score and re-runs moderation on the same data, which doesn't help when the underlying data is the problem. This feature adds a Research button that uses Gemini with Google Search grounding to look up the item on the web, find the correct URL, and update the item before re-moderating.

---

## User Stories

### Moderation Queue

**US-001: Research a broken news item from the web UI**
> As an admin reviewing the moderation queue, I want to click a Research button on a news or event item so that the system searches the web for the correct URL and updates the item automatically.

Acceptance Criteria:
- [x] Research button appears for news and event items (not photos)
- [x] Button shows "Researching..." loading state while active
- [x] If a new URL is found, the item's source_url is updated in the DB
- [x] Item is requeued for re-moderation after research completes
- [x] Success notification reports whether the URL changed

**US-002: Research a broken item via MCP**
> As an admin using Claude Code, I want to research a content item via the MCP `queue_research` tool so that I can fix bad URLs without opening the browser.

Acceptance Criteria:
- [x] `queue_research` tool accepts content_type (news/event) and id
- [x] Returns descriptive text with URL update info
- [x] Item is requeued for moderation after research

---

## Data Model

No schema changes. Uses existing `poi_news.source_url` and `poi_events.source_url` columns.

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/admin/moderation/research` | Research item via AI web search, update URL, requeue | Admin |

### Request Body

```json
{ "type": "news", "id": 123 }
```

### Response

```json
{
  "success": true,
  "researched": true,
  "source_url_updated": true,
  "old_url": "https://old-broken-url.com",
  "new_url": "https://correct-url.com",
  "ai_notes": "Found the article on the organization's news page"
}
```

---

## UI/UX Requirements

### Modified Components

- `ModerationInbox.jsx` — Research button (blue, `#1565c0`) added in both pending and non-pending action areas, only for news/event items

---

## Dependencies

- Depends on: Gemini API key configured in admin_settings
- Depends on: Google Search grounding available in Gemini 2.5 Flash

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-28 | Implemented |
