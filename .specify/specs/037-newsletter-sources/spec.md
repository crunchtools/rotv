# Specification: Newsletter Source Management

> **Spec ID:** 037-newsletter-sources
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-06-22

## Overview

Redesign the "Inbound Newsletters" section on the settings/newsletter page to manage newsletter **sources** (unique senders) instead of individual emails. A source is identified by its sender email address and can be accepted (mapped to a POI), blocked, or deleted. Once accepted, all emails from that source flow through the standard content/moderation queue automatically and never appear on the settings page. Individual email details remain accessible via the MCP server for debugging.

---

## User Stories

### Source Management

**US-037-1: View Newsletter Sources**
> As an admin, I want to see a list of newsletter sources (unique senders) so that I can manage which organizations feed content into ROTV.

Acceptance Criteria:
- [ ] Settings page shows one row per unique sender, not one row per email
- [ ] Each source shows: sender email, display name (editable), status, assigned POI, email count, last received date
- [ ] Sources are grouped by status: new/pending first, then accepted, then blocked

**US-037-2: Accept a Newsletter Source**
> As an admin, I want to assign a new sender to a POI so that all its emails are processed through the standard collection pipeline.

Acceptance Criteria:
- [ ] Admin selects a POI from a dropdown and clicks "Accept"
- [ ] A `poi_newsletter_sources` row is created mapping the sender to the POI
- [ ] All unprocessed emails from that sender are queued for reprocessing
- [ ] The source moves from "new" to "accepted" status

**US-037-3: Block a Newsletter Source**
> As an admin, I want to block a sender so that its emails are silently ignored and don't clutter the queue.

Acceptance Criteria:
- [ ] Admin clicks "Block" on a source
- [ ] The source is marked as blocked in `poi_newsletter_sources`
- [ ] Future emails from that sender are not queued for processing
- [ ] Blocked sources appear in a collapsed section at the bottom

**US-037-4: Delete a Newsletter Source**
> As an admin, I want to delete a source and all its emails so that spam/junk senders are fully purged.

Acceptance Criteria:
- [ ] Admin clicks "Delete" with a confirmation prompt
- [ ] The source mapping row is deleted
- [ ] All `newsletter_emails` rows from that sender are deleted
- [ ] The source disappears from the list entirely

---

## Data Model

### Schema Changes

Evolve `poi_newsletter_sources` from a simple mapping table into a proper source entity:

```sql
-- Add columns to poi_newsletter_sources
ALTER TABLE poi_newsletter_sources
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted';

-- Allow blocked sources (no POI required) by making poi_id nullable
-- and changing the primary key to from_pattern alone
```

**Key change:** Currently `poi_newsletter_sources` has a composite PK of `(poi_id, from_pattern)` and `poi_id NOT NULL`. Blocked sources have no POI, so `poi_id` must become nullable. The primary key changes to just `from_pattern` (a sender can only map to one destination).

New schema for `poi_newsletter_sources`:

| Column | Type | Description |
|--------|------|-------------|
| `from_pattern` | TEXT PK | Sender email pattern (case-insensitive substring match) |
| `poi_id` | INTEGER NULL FK | Assigned POI (NULL for blocked sources) |
| `display_name` | TEXT NULL | Admin-friendly name (e.g., "Akron Zoo Newsletter") |
| `status` | TEXT NOT NULL | `accepted`, `blocked`, or `new` |
| `created_at` | TIMESTAMPTZ | When the source was first seen |

### Auto-Discovery of New Sources

When a new email arrives and no `poi_newsletter_sources` row matches its `from_address`, the newsletter service inserts a row with `status = 'new'` and `poi_id = NULL`. This surfaces the sender on the settings page for admin triage.

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/newsletter/sources` | List all newsletter sources with email counts | Admin |
| PUT | `/api/newsletter/sources/:pattern` | Update a source (assign POI, block, rename) | Admin |
| DELETE | `/api/newsletter/sources/:pattern` | Delete a source and its emails | Admin |

### Deprecated Endpoints

| Method | Path | Replacement |
|--------|------|-------------|
| GET | `/api/newsletter/inbound` | `/api/newsletter/sources` |
| POST | `/api/newsletter/inbound/:id/assign-poi` | `PUT /api/newsletter/sources/:pattern` |
| POST | `/api/newsletter/inbound/:id/reprocess` | Kept (still useful for individual email retry via MCP) |

### GET /api/newsletter/sources

Returns sources with aggregated email stats:

```json
[
  {
    "from_pattern": "news@akronzoo.org",
    "display_name": "Akron Zoo",
    "status": "accepted",
    "poi_id": 42,
    "poi_name": "Akron Zoo",
    "email_count": 23,
    "last_received": "2026-06-20T14:30:00Z",
    "total_news": 45,
    "total_events": 12
  }
]
```

### PUT /api/newsletter/sources/:pattern

Request body (all fields optional):

```json
{
  "poi_id": 42,
  "status": "accepted",
  "display_name": "Akron Zoo Newsletter"
}
```

Setting `status` to `accepted` with a `poi_id` queues all unprocessed emails from that sender for reprocessing.

---

## UI/UX Requirements

### Redesigned "Inbound Newsletters" Section

Replace the per-email list with a source management table:

```
┌─────────────────────────────────────────────────────────────┐
│  📥 Newsletter Sources                                      │
│  Manage which organizations can send content via email.     │
│                                                              │
│  ⚠ NEW (2)                                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ unknown@cvnpa.org          3 emails · last: Jun 20     ││
│  │ [Select POI ▼] [Accept] [Block] [Delete]               ││
│  ├─────────────────────────────────────────────────────────┤│
│  │ alerts@summitcounty.gov    1 email · last: Jun 18      ││
│  │ [Select POI ▼] [Accept] [Block] [Delete]               ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ✓ ACCEPTED (4)                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ news@akronzoo.org          23 emails → Akron Zoo       ││
│  │ "Akron Zoo"     45 news, 12 events      [Edit] [Block] ││
│  ├─────────────────────────────────────────────────────────┤│
│  │ info@metroparks.cc         15 emails → Summit Metro... ││
│  │ "Summit Metro Parks"  22 news, 8 events [Edit] [Block] ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ✗ BLOCKED (1) ▸                                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ spam@example.com           2 emails     [Unblock] [Del]││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## Non-Functional Requirements

**NFR-037-1: Backward Compatibility**
- Existing `poi_newsletter_sources` rows (status-less) are treated as `accepted`
- The MCP `newsletter_assign_poi` tool continues to work (creates source with `accepted` status)
- The reprocess endpoint stays for MCP individual-email operations

---

## Dependencies

- Depends on: 060_add_poi_newsletter_sources.sql (existing migration)
- Blocks: none

---

## Open Questions

1. ~~Should we support regex patterns in `from_pattern` or keep substring matching?~~ Keep substring — simpler, covers all real cases.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-06-22 | Initial draft |
