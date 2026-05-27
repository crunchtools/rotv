# Specification: Per-Item Notification Read State & Publication-Date Ordering

> **Spec ID:** 025-notification-read-state
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-27

## Overview

The notification bell currently marks every notification as read the moment the
dropdown is opened, clearing the unread badge in one shot. It also orders items
primarily by collection date, so the feed reads in the order ROTV scraped
content rather than by when the content was published. This change makes read
state per-item (Facebook-style: items stay tinted until individually clicked)
and reorders the feed newest-publication-date first.

Fixes #412.

---

## User Stories

### Notifications

**US-025-1: Per-item read state**
> As a follower of places, I want each notification to stay highlighted until I
> click it individually, so that opening the bell doesn't erase my place and I
> can tell which updates I've actually looked at.

Acceptance Criteria:
- [ ] Opening the bell does NOT mark all items read and does NOT clear the badge.
- [ ] Every notification is tinted until the user clicks it; clicking removes its
      tint (Facebook-style — viewing the list is not "reading").
- [ ] The unread badge count equals the number of not-yet-clicked items and
      decrements by one as each item is read.
- [ ] Read state persists across reloads (localStorage).
- [ ] The read set is pruned to items still present in the feed so storage stays
      bounded.

**US-025-2: Newest publication date first**
> As a follower of places, I want notifications ordered by when the content was
> published (news) or scheduled (events), newest first, so the feed reads like a
> real news feed instead of scrape order.

Acceptance Criteria:
- [ ] News items sort by `publication_date` (falling back to `collection_date`).
- [ ] Event items sort by `start_date` (falling back to `collection_date`).
- [ ] The merged list is ordered newest-first across both types.
- [ ] The "time ago" label reflects the same date used for sorting.

**US-025-3: Navigate to the in-app permalink, stay on site**
> As a follower of places, I want clicking a notification to open that news/event
> inside ROTV (its permalink detail), so I can read it and move through my unread
> items without leaving the site — then click out to the external article only if
> I choose to.

Acceptance Criteria:
- [ ] Clicking a notification navigates to the in-app permalink
      (`/{poiSlug}/news/{titleSlug}` or `/{poiSlug}/events/{titleSlug}`) and opens
      the detail view — it does NOT open the external source URL directly.
- [ ] The notification dropdown closes on navigation.
- [ ] The external article remains reachable via the detail view's existing
      "read more" link.
- [ ] Clicking marks that one item read (US-025-1) regardless of navigation.

---

## Data Model

No schema changes. Read state lives entirely in browser `localStorage`.

| Key | Description |
|-----|-------------|
| `rotv-notifications-read` | JSON array of read item keys (e.g. `["news-12","event-5"]`). An item is unread iff its key is not in this set. The legacy `rotv-notifications-last-seen` key is no longer used. |

---

## API Endpoints

No API changes. `GET /api/notifications/feed` already returns
`publication_date`, `collection_date`, `start_date` per item; ordering is a
client concern in `normalize()`.

---

## UI/UX Requirements

### Modified Components

- `NotificationBell` — track a per-item read set, compute unread from it, mark an
  item read on click, and stop clearing all-read on open. Re-sort using
  publication/start dates.

### Behavior

- Tint (`.notification-item.unread`, existing light-green style) shown when an
  item is in the unread set.
- Clicking anywhere on an item marks it read (and still opens its link if present).

---

## Non-Functional Requirements

**NFR-025-1: Bounded storage**
- The read set is pruned to keys still present in the current feed on each load,
  so `localStorage` does not grow without bound.

**NFR-025-2: Graceful degradation**
- All `localStorage` access stays wrapped in try/catch (private mode / quota).

---

## Dependencies

- Depends on: 019-poi-subscriptions (introduced the notification bell)
- Blocks: none

---

## Open Questions

_None — event sort key (start_date) confirmed with stakeholder._

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-27 | Initial draft |
