# Implementation Plan: Per-Item Notification Read State & Publication-Date Ordering

> **Spec ID:** 025-notification-read-state
> **Status:** Planning
> **Last Updated:** 2026-05-27
> **Estimated Effort:** S

## Summary

Client-only change in `NotificationBell.jsx`: replace the single "last seen"
mark-all-read model with a per-item read set in localStorage, and change the
`normalize()` sort/age field from collection-date-first to publication/start-date.

---

## Architecture

### Data Flow

1. Load the read set (`rotv-notifications-read`) — a JSON array of item keys.
2. `loadFeed()` fetches `/api/notifications/feed`, normalizes, and sorts by
   publication/start date. A separate effect prunes the read set to keys still
   present in the feed.
3. `unread` = items whose key is not in the read set. Opening the dropdown does
   not mutate read state.
4. Clicking an item adds its key to the read set, persists it, navigates to the
   in-app permalink, and closes the dropdown.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Read state | `localStorage` JSON array | No backend/schema change; matches existing anon-friendly pattern. |

---

## Implementation Steps

### Phase 1: Ordering

- [ ] In `normalize()`, set news `activityTime = n.publication_date || n.collection_date`.
- [ ] Set event `activityTime = e.start_date || e.collection_date`.
- [ ] Keep the existing descending merged sort.

### Phase 2: Per-item read state

- [ ] Add read-set helpers (read/write) for `rotv-notifications-read`.
- [ ] Compute `unread` purely from the read set (item unread iff not in set).
- [ ] Prune the read set to live feed keys in an effect.
- [ ] Add per-item click handler that marks read and navigates.
- [ ] Remove the mark-all-read / `setUnread(0)` logic from `handleToggle`.
- [ ] Drive `.unread` tint from the read set.

### Phase 3: In-app permalink navigation

- [ ] Import `useNavigate` (bell is inside `<BrowserRouter>`) and `generateSlug`
      from `sidebar/helpers`.
- [ ] On item click, `navigate('/{poiSlug}/{news|events}/{titleSlug}')` instead
      of opening the external `<a>`; close the dropdown.
- [ ] Replace the external link markup with an accessible `<button>` row; add
      minimal `.notification-item-btn` CSS.
- [ ] No `App.jsx` change: the pathname-driven effect (deps include
      `location.pathname`, App.jsx:1024) sets `permalinkInfo` → `ContentDetail`.

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/NotificationBell.jsx` | Read-set model, click-to-read, sort field change, in-app permalink navigation. |
| `frontend/src/App.css` | Add `.notification-item-btn` styles for the clickable row. |

---

## Testing Strategy

### Manual Testing

1. Follow ≥2 POIs with recent news/events; confirm the badge shows a count.
2. Open the bell — badge stays, all items tinted.
3. Click one item — its tint clears, badge decrements by one, others stay tinted.
4. Reload — read items stay read, unread stay tinted, badge persists.
5. Confirm feed order is newest publication/start date at the top.

---

## Rollback Plan

1. Revert the single-file change to `NotificationBell.jsx`.
2. No data migration to undo (localStorage only; stale keys are harmless).

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Existing users see all current items tinted on upgrade | Low | Intended Facebook-style behavior; badge caps at "9+"; feed is bounded to recent items. |
| `localStorage` unavailable (private mode) | Low | All access wrapped in try/catch; falls back to in-memory. |
| Read set growth | Low | Pruned to current feed keys each load. |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-27 | Initial plan |
