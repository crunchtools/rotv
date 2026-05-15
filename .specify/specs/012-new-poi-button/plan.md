# Implementation Plan: New Button for Results, News & Events Tabs

> **Spec ID:** 012-new-poi-button
> **Status:** Planning
> **Last Updated:** 2026-05-15
> **Estimated Effort:** L

## Summary

Add "New" buttons to the Results, News, and Events tabs that integrate with the existing Sidebar edit panel and POI creation API. The Results tab buttons create POIs with role defaults matching the active sub-tab. News and Events tabs get simple creation forms for manual content entry.

---

## Architecture

### Data Flow — New POI from Results Tab

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  ResultsTab  │     │    App.jsx   │     │   Map.jsx    │     │  Sidebar.jsx │
│  [+ New] btn │────▶│ handleNew()  │────▶│ click-to-    │────▶│ Edit form    │
│              │     │ sets newPOI  │     │ place mode   │     │ w/ roles     │
└──────────────┘     │ w/ default   │     │ (for points) │     │ + GeoJSON    │
                     │ poi_roles    │     └──────────────┘     │ + save       │
                     └──────────────┘                          └──────┬───────┘
                                                                      │
                                                          POST /api/admin/pois
```

### Data Flow — New News/Event

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  ParkNews    │     │ NewNewsForm  │     │ Backend API  │
│  [+ New] btn │────▶│ (modal)      │────▶│ POST /admin/ │
│              │     │ POI + title  │     │ news         │
└──────────────┘     │ + summary    │     └──────────────┘
                     └──────────────┘
```

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Role editor | HTML checkboxes + existing chip styles | Simple, matches existing UI patterns |
| GeoJSON upload | `<input type="file">` + JSON.parse validation | No extra dependencies needed |
| GeoJSON preview | Leaflet `<GeoJSON>` component (already used) | Already in the codebase for linear features |
| News/Event forms | Modal component | Matches existing modal patterns (NewPOIForm) |

---

## Implementation Steps

### Phase 1: Results Tab — New Button + Sidebar Integration

- [ ] Pass `editMode`, `isAdmin`, `role` props to `ResultsTab`
- [ ] Add "New" button to `ResultsTab` header area, right-aligned in sub-tab bar
- [ ] Button visibility: `editMode && (isAdmin || role === 'poi_admin')`
- [ ] Add `onNewPOI` callback prop — calls up to App.jsx
- [ ] In App.jsx, add `handleNewPOIFromResults(subTab)` that:
  - Determines default roles from sub-tab (`all` → `['point']`, `mtb` → `['point']` + `is_mtb_trail`, `organizations` → `['organization']`)
  - Calls `setNewPOI()` with the appropriate defaults including `poi_roles`
  - For point-role POIs: switches to map view in "click to place" mode
  - For organizations: opens Sidebar directly (no coordinates needed)
- [ ] Modify Sidebar to accept and display pre-set `poi_roles` on new POI objects

### Phase 2: Role Editor in Sidebar

- [ ] Create `RoleEditor.jsx` component — checkbox list of valid roles
- [ ] Add to Sidebar's EditView when `isNewPOI || isNewOrganization`
- [ ] Also show in existing edit mode for established POIs (allows role changes)
- [ ] Wire role changes to `editedData.poi_roles` state
- [ ] Validate at least one role selected before save

### Phase 3: GeoJSON Upload

- [ ] Create `GeoJSONUploader.jsx` component
- [ ] Show in Sidebar edit form when POI has trail, river, or boundary role
- [ ] File input accepts `.geojson`, `.json`
- [ ] On file select: parse JSON, validate GeoJSON structure, extract geometry
- [ ] Store geometry in `editedData.geometry`
- [ ] Render preview on map via temporary `<GeoJSON>` layer
- [ ] On save: geometry sent as part of `POST /api/admin/pois` body
- [ ] Backend: ensure `geometry` is in `allowedFields` for POST /api/admin/pois

### Phase 4: News Tab — New Button + Form

- [ ] Add "New" button to ParkNews component header
- [ ] Button visibility: `editMode && isAdmin`
- [ ] Create `NewNewsForm.jsx` modal component
- [ ] Form fields: POI selector (dropdown of all POIs), title, summary, source URL, source name, news type, publication date
- [ ] Add `POST /api/admin/news` endpoint in admin.js
- [ ] Endpoint creates `poi_news` row with `content_source: 'manual'`, `moderation_status: 'published'`
- [ ] Refresh news feed after creation

### Phase 5: Events Tab — New Button + Form

- [ ] Add "New" button to ParkEvents component header
- [ ] Button visibility: `editMode && isAdmin`
- [ ] Create `NewEventForm.jsx` modal component
- [ ] Form fields: POI selector, title, start date, end date, description, event type, location details, source URL
- [ ] Add `POST /api/admin/events` endpoint in admin.js
- [ ] Endpoint creates `poi_events` row with `content_source: 'manual'`, `moderation_status: 'published'`
- [ ] Refresh events feed after creation

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/RoleEditor.jsx` | POI role checkbox/chip editor |
| `frontend/src/components/GeoJSONUploader.jsx` | GeoJSON file upload with validation |
| `frontend/src/components/NewNewsForm.jsx` | Modal form for manual news creation |
| `frontend/src/components/NewEventForm.jsx` | Modal form for manual event creation |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/App.jsx` | Add `handleNewPOIFromResults()`, pass editMode/role to ResultsTab, wire new handlers |
| `frontend/src/components/ResultsTab.jsx` | Add New button in sub-tab bar, onNewPOI callback |
| `frontend/src/components/Sidebar.jsx` | Import RoleEditor + GeoJSONUploader, show in edit form, handle poi_roles in editedData |
| `frontend/src/components/Map.jsx` | No changes expected — existing click-to-place already works |
| `frontend/src/components/ParkNews.jsx` | Add New button + NewNewsForm modal trigger |
| `frontend/src/components/ParkEvents.jsx` | Add New button + NewEventForm modal trigger |
| `backend/routes/admin.js` | Add POST /admin/news, POST /admin/events endpoints; ensure geometry in allowedFields for POST /pois |

---

## API Implementation

### Endpoint: `POST /api/admin/news`

**Request:**
```json
{
  "poi_id": 42,
  "title": "Trail reopens after restoration",
  "summary": "The Towpath Trail section near Lock 29...",
  "source_url": "https://example.com/article",
  "source_name": "Valley News",
  "news_type": "general",
  "publication_date": "2026-05-15"
}
```

**Response:**
```json
{
  "id": 123,
  "poi_id": 42,
  "title": "Trail reopens after restoration",
  "content_source": "manual",
  "moderation_status": "published",
  "collection_date": "2026-05-15T12:00:00Z"
}
```

### Endpoint: `POST /api/admin/events`

**Request:**
```json
{
  "poi_id": 42,
  "title": "Summer Concert Series",
  "start_date": "2026-06-01",
  "end_date": "2026-08-31",
  "description": "Weekly concerts at...",
  "event_type": "concert",
  "location_details": "Howe Meadow",
  "source_url": "https://example.com/events"
}
```

**Response:**
```json
{
  "id": 456,
  "poi_id": 42,
  "title": "Summer Concert Series",
  "content_source": "manual",
  "moderation_status": "published",
  "collection_date": "2026-05-15T12:00:00Z"
}
```

---

## Testing Strategy

### Integration Tests

- [ ] `backend/tests/newPoi.integration.test.js` — POST /api/admin/pois with various role combinations
- [ ] `backend/tests/newNews.integration.test.js` — POST /api/admin/news creates manual news item
- [ ] `backend/tests/newEvents.integration.test.js` — POST /api/admin/events creates manual event

### Manual Testing

1. Log in as admin, enable edit mode
2. Navigate to Results > POIs, click New — verify sidebar opens with point role, click map to place
3. Navigate to Results > MTB, click New — verify is_mtb_trail default
4. Navigate to Results > Organizations, click New — verify organization role, no coordinates required
5. Test role editor: add/remove roles, verify validation
6. Upload a GeoJSON file for a trail — verify preview on map and save
7. Navigate to News tab, click New — create manual news item
8. Navigate to Events tab, click New — create manual event
9. Verify buttons are NOT visible when logged out or edit mode is off
10. Verify buttons are NOT visible for `media_admin` or `viewer` roles

---

## Rollback Plan

If issues are discovered:
1. Revert the PR — all changes are additive (new buttons, new endpoints)
2. No database migrations to roll back
3. No existing functionality modified in a breaking way

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sidebar is 3500+ lines — complex to modify | Med | Minimize changes — add RoleEditor as self-contained component, only add import + render call |
| App.jsx is 3600+ lines — complex state management | Med | Follow existing `handleStartNewPOI` pattern exactly, minimal new state |
| GeoJSON files could be very large | Low | Add client-side file size limit (e.g., 5MB), validate structure before upload |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-15 | Initial plan |
