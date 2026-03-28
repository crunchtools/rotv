# Specification: Publication Date Extraction

> **Spec ID:** 002-publication-date
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-03-28

## Overview

AI content collection treats everything it scrapes as "new," even when the source content is years old. Items are sorted by collection date (`created_at`), making it impossible to distinguish genuinely new content from old-but-first-time-collected articles. This feature adds publication date extraction during the AI moderation step with a three-tier confidence model: exact, estimated, and unknown.

**Key constraint:** Staleness is NOT a rejection criterion. Old content has archival value — ROTV serves as a living history journal of the valley. Publication date is for sorting and filtering only.

---

## User Stories

### Content Moderation

**US-001: Publication Date Extraction**
> As a content moderator, I want the AI to extract or estimate the publication date from source content so that I can distinguish new articles from old ones in the queue.

Acceptance Criteria:
- [ ] AI moderation extracts exact dates when found in source content
- [ ] AI moderation estimates dates from context clues when exact date unavailable
- [ ] Items with no determinable date are flagged with `date_confidence = 'unknown'`
- [ ] Publication date and confidence are stored in the database

**US-002: Queue Display**
> As an admin, I want to see publication dates in the moderation queue so that I can prioritize genuinely new content.

Acceptance Criteria:
- [ ] Publication date displayed in queue item rows
- [ ] Date confidence indicator shown (exact/estimated/unknown)
- [ ] Unknown-date items visually flagged for human review

**US-003: MCP Tool Access**
> As an MCP client, I want publication date and confidence returned in queue/detail responses so that I can filter and sort programmatically.

Acceptance Criteria:
- [ ] `queue_list` responses include `publication_date` and `date_confidence`
- [ ] `queue_item_detail` responses include `publication_date` and `date_confidence`
- [ ] `poi_news` and `poi_events` tool responses include the new fields

---

## Data Model

### Schema Changes

```sql
-- Add publication date columns to poi_news
ALTER TABLE poi_news ADD COLUMN publication_date DATE;
ALTER TABLE poi_news ADD COLUMN date_confidence VARCHAR(10) DEFAULT 'unknown';
ALTER TABLE poi_news ADD CONSTRAINT chk_news_date_confidence
    CHECK (date_confidence IN ('exact', 'estimated', 'unknown'));

-- Add publication date columns to poi_events
ALTER TABLE poi_events ADD COLUMN publication_date DATE;
ALTER TABLE poi_events ADD COLUMN date_confidence VARCHAR(10) DEFAULT 'unknown';
ALTER TABLE poi_events ADD CONSTRAINT chk_events_date_confidence
    CHECK (date_confidence IN ('exact', 'estimated', 'unknown'));
```

---

## API Endpoints

No new endpoints. Existing endpoints return the new fields automatically:

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/admin/moderation/queue` | Returns `publication_date`, `date_confidence` |
| GET | `/api/admin/moderation/item/:type/:id` | Returns `publication_date`, `date_confidence` |

---

## UI/UX Requirements

### Modified Components

- `ModerationInbox` — Show publication date next to `created_at` timestamp with confidence badge

---

## Non-Functional Requirements

**NFR-001: No Behavioral Changes**
- Publication date extraction must NOT affect approval/rejection logic
- Items with `date_confidence = 'unknown'` are NOT auto-rejected
- Existing auto-approve threshold behavior unchanged

---

## Dependencies

- Depends on: 000-baseline (moderation pipeline)
- Blocks: none

---

## Open Questions

None — requirements are well-defined.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-03-28 | Initial draft |
