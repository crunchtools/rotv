# Implementation Plan: Newsletter Source Management

> **Spec ID:** 037-newsletter-sources
> **Status:** Planning
> **Last Updated:** 2026-06-22
> **Estimated Effort:** M

## Summary

Evolve `poi_newsletter_sources` into a proper source entity with status/display_name columns, add REST endpoints for source CRUD, auto-discover new senders in the newsletter service, and replace the per-email UI with a per-source management interface.

---

## Architecture

### Data Flow

1. Email arrives at SMTP → stored in `newsletter_emails`
2. Newsletter service checks `poi_newsletter_sources` for matching `from_pattern`
3. **No match:** inserts a `poi_newsletter_sources` row with `status='new'`, `poi_id=NULL` (auto-discovery)
4. **Match + accepted:** processes through standard collection pipeline → content queue
5. **Match + blocked:** marks email processed, skips extraction
6. **Match + new:** email sits unprocessed, source appears on settings page for admin triage
7. Admin accepts/blocks/deletes via settings UI → updates `poi_newsletter_sources`

---

## Implementation Steps

### Phase 1: Database Migration

- [ ] Create migration `061_newsletter_source_entity.sql`
  - Drop the composite PK `(poi_id, from_pattern)`, add PK on `from_pattern`
  - Make `poi_id` nullable
  - Add `display_name TEXT` column
  - Add `status TEXT NOT NULL DEFAULT 'accepted'` column
  - Backfill existing rows with `status = 'accepted'`

### Phase 2: Backend — Auto-Discovery in Newsletter Service

- [ ] Modify `newsletterService.js` `processNewsletterById()`:
  - When no `poi_newsletter_sources` match exists for the sender, INSERT a row with `status='new'`, `poi_id=NULL`
  - When match exists but `status='blocked'`, mark email processed and skip extraction
  - When match exists and `status='new'`, leave email unprocessed (waiting for admin)

### Phase 3: Backend — Source CRUD Endpoints

- [ ] Add `GET /api/newsletter/sources` in `newsletter.js`:
  - Query `poi_newsletter_sources` joined with aggregated `newsletter_emails` counts
  - Return: from_pattern, display_name, status, poi_id, poi_name, email_count, last_received, total_news, total_events
  - Order: new first, then accepted, then blocked

- [ ] Add `PUT /api/newsletter/sources/:pattern`:
  - Update status, poi_id, display_name
  - When changing to `accepted` with a poi_id: queue all unprocessed emails from that sender
  - When changing to `blocked`: no reprocessing needed

- [ ] Add `DELETE /api/newsletter/sources/:pattern`:
  - Delete the `poi_newsletter_sources` row
  - Delete all `newsletter_emails` where `from_address` matches the pattern

### Phase 4: Frontend — Replace Per-Email List with Source Management

- [ ] Rewrite the "Inbound Newsletters" section in `NewsletterSettings.jsx`:
  - Fetch from `/api/newsletter/sources` instead of `/api/newsletter/inbound`
  - Group sources by status: new → accepted → blocked
  - New sources: POI dropdown + Accept/Block/Delete buttons
  - Accepted sources: show POI name, email/extraction counts, Edit/Block buttons
  - Blocked sources: collapsible section with Unblock/Delete buttons
  - Remove all per-email state (`inbound`, `assignSel`, `handleReprocess`, `handleAssign`)

### Phase 5: MCP Server Updates

- [ ] Add `newsletter_sources` MCP tool (list sources with stats)
- [ ] Keep existing `newsletter_list`, `newsletter_detail`, `newsletter_reprocess` tools unchanged
- [ ] Update `newsletter_assign_poi` to set `status='accepted'` when creating/updating a source

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/061_newsletter_source_entity.sql` | Schema evolution for source entity |

### Modified Files

| File | Changes |
|------|---------|
| `backend/routes/newsletter.js` | Add source CRUD endpoints, deprecate `/inbound` |
| `backend/services/newsletterService.js` | Auto-discover new senders, respect blocked status |
| `backend/services/mcpServer.js` | Add `newsletter_sources` tool, update `newsletter_assign_poi` |
| `frontend/src/components/NewsletterSettings.jsx` | Replace per-email list with source management UI |

---

## Database Migrations

```sql
-- Migration: 061_newsletter_source_entity.sql
-- Evolve poi_newsletter_sources from mapping table to source entity

-- 1. Add new columns
ALTER TABLE poi_newsletter_sources
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted';

-- 2. Make poi_id nullable (blocked sources have no POI)
ALTER TABLE poi_newsletter_sources ALTER COLUMN poi_id DROP NOT NULL;

-- 3. Change primary key from (poi_id, from_pattern) to just from_pattern
--    A sender can only map to one destination.
ALTER TABLE poi_newsletter_sources DROP CONSTRAINT IF EXISTS poi_newsletter_sources_pkey;
ALTER TABLE poi_newsletter_sources ADD PRIMARY KEY (from_pattern);

-- 4. Add unique constraint to prevent duplicate patterns
--    (PK already handles this, but explicit for clarity)
```

---

## Testing Strategy

### Manual Testing

1. Start the app, navigate to Settings → Newsletter
2. Verify existing sources appear with "accepted" status and their POI assignments
3. Forward a new email to news@rootsofthevalley.org from an unknown sender
4. Verify the new sender appears as "new" on the settings page
5. Accept it by assigning a POI — verify emails get processed into content queue
6. Block a source — verify future emails from it are skipped
7. Delete a source — verify the source and all its emails are purged
8. Verify MCP `newsletter_list` and `newsletter_detail` still work for individual emails

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PK migration fails on existing data | High | Use IF NOT EXISTS, handle conflicts |
| Blocked senders re-appear as "new" | Med | Check for blocked status before auto-inserting |
| Pattern matching ambiguity (substring vs exact) | Low | Keep existing substring matching, it works |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-06-22 | Initial plan |
