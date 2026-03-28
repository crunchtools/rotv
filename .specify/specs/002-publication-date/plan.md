# Implementation Plan: Publication Date Extraction

> **Spec ID:** 002-publication-date
> **Status:** Planning
> **Last Updated:** 2026-03-28
> **Estimated Effort:** M

## Summary

Add `publication_date` and `date_confidence` columns to `poi_news` and `poi_events`, extract dates during AI moderation via an expanded Gemini prompt, and surface the new fields in the frontend queue and MCP tools.

---

## Architecture

### Data Flow

1. AI moderation prompt asks Gemini to extract/estimate publication date alongside existing scoring
2. Gemini returns `publication_date` and `date_confidence` in its JSON response
3. `moderationService.js` saves the new fields when writing moderation results
4. Frontend `ModerationInbox` displays publication date and confidence badge
5. MCP tools include new fields in query responses

---

## Implementation Steps

### Phase 1: Database

- [ ] Create migration `005_add_publication_date.sql`
- [ ] Add `publication_date DATE` and `date_confidence VARCHAR(10)` to `poi_news`
- [ ] Add `publication_date DATE` and `date_confidence VARCHAR(10)` to `poi_events`
- [ ] Add CHECK constraints for `date_confidence IN ('exact', 'estimated', 'unknown')`
- [ ] Update `moderation_queue` VIEW to include new columns

### Phase 2: AI Moderation Prompt

- [ ] Update `moderateContent()` in `geminiService.js` to request `publication_date` and `date_confidence` in the JSON response schema
- [ ] Add date extraction instructions to the moderation prompt (three-tier logic)

### Phase 3: Moderation Service

- [ ] Update `processItem()` in `moderationService.js` to save `publication_date` and `date_confidence` from AI response
- [ ] Update all news/event UPDATE queries that write moderation results to include the new columns
- [ ] Handle null/missing publication_date gracefully (default to `date_confidence = 'unknown'`)

### Phase 4: Frontend

- [ ] Update `ModerationInbox.jsx` to display publication date in queue item rows
- [ ] Add date confidence badge (color-coded: green=exact, yellow=estimated, red=unknown)
- [ ] Show publication date next to the existing `created_at` timestamp

### Phase 5: MCP Tools

- [ ] Update `getQueue()` UNION query in `moderationService.js` to include `publication_date`, `date_confidence`
- [ ] Update `poi_news` and `poi_events` tool queries in `mcpServer.js` to include new columns

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/005_add_publication_date.sql` | Database migration |

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/geminiService.js` | Expand `moderateContent()` prompt to extract publication date |
| `backend/services/moderationService.js` | Save publication_date/date_confidence in processItem(); update getQueue() UNION query |
| `frontend/src/components/ModerationInbox.jsx` | Display publication date and confidence badge |
| `backend/services/mcpServer.js` | Add publication_date/date_confidence to poi_news and poi_events tool queries |

---

## Database Migration

```sql
-- Migration 005: Add publication date extraction fields
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS publication_date DATE;
ALTER TABLE poi_news ADD COLUMN IF NOT EXISTS date_confidence VARCHAR(10) DEFAULT 'unknown';

ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS publication_date DATE;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS date_confidence VARCHAR(10) DEFAULT 'unknown';

-- CHECK constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_news_date_confidence') THEN
        ALTER TABLE poi_news ADD CONSTRAINT chk_news_date_confidence
            CHECK (date_confidence IN ('exact', 'estimated', 'unknown'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_events_date_confidence') THEN
        ALTER TABLE poi_events ADD CONSTRAINT chk_events_date_confidence
            CHECK (date_confidence IN ('exact', 'estimated', 'unknown'));
    END IF;
END $$;

-- Update moderation_queue VIEW to include new columns
CREATE OR REPLACE VIEW moderation_queue AS
  SELECT id, 'news' AS content_type, poi_id, title, summary AS description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at,
         publication_date, date_confidence
  FROM poi_news WHERE moderation_status = 'pending'
  UNION ALL
  SELECT id, 'event' AS content_type, poi_id, title, description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at,
         publication_date, date_confidence
  FROM poi_events WHERE moderation_status = 'pending'
  UNION ALL
  SELECT id, 'photo' AS content_type, poi_id, original_filename AS title, caption AS description,
         moderation_status, confidence_score, ai_reasoning,
         submitted_by, moderated_by, moderated_at, created_at,
         NULL::DATE AS publication_date, NULL::VARCHAR AS date_confidence
  FROM photo_submissions WHERE moderation_status = 'pending'
  ORDER BY created_at DESC;
```

---

## Testing Strategy

### Manual Testing

1. Trigger news collection for a POI with known old articles
2. Verify publication_date and date_confidence are populated after moderation
3. Verify ModerationInbox shows the new fields
4. Verify MCP `queue_list` and `poi_news`/`poi_events` return new fields
5. Verify items with unknown dates are NOT rejected

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM returns bad date format | Low | Parse with fallback, default to 'unknown' |
| Existing items have NULL publication_date | Low | Default 'unknown' confidence, NULLs are expected |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-03-28 | Initial plan |
