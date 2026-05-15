# Specification: New Button for Results, News & Events Tabs

> **Spec ID:** 012-new-poi-button
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-15

## Overview

Add a "New" button to the Results, News, and Events tabs that is only visible when the user is in Edit mode and has the appropriate admin role. On the Results tab, clicking New creates a POI with a default role matching the active sub-tab (point for POIs, organization for Organizations, trail with is_mtb_trail for MTB). The creation flow uses the existing Sidebar edit panel rather than the legacy modal, allowing role editing, GeoJSON upload, and map-click coordinate selection.

---

## User Stories

### Results Tab — New POI

**US-012-01: Create new Point from Results > POIs sub-tab**
> As an admin in edit mode viewing the Points of Interest sub-tab, I want to click a "New" button so that I can create a new POI with the `point` role pre-selected.

Acceptance Criteria:
- [ ] "New" button appears in the Results tab header area when `editMode === true` and user is `admin` or `poi_admin`
- [ ] Clicking New opens the Sidebar in edit/create mode with `poi_roles: ['point']` pre-set
- [ ] The map enters "click to place" mode — clicking the map sets coordinates on the new POI
- [ ] User can drag the placed marker to adjust position
- [ ] User can add additional roles (trail, river, boundary, organization) via a role editor
- [ ] Saving calls `POST /api/admin/pois` with the correct roles and coordinates
- [ ] New POI appears in the results list and on the map after creation

**US-012-02: Create new MTB Trail from Results > MTB sub-tab**
> As an admin in edit mode viewing the MTB Trail Status sub-tab, I want to click "New" so that I can create a new MTB trailhead POI.

Acceptance Criteria:
- [ ] "New" button appears in MTB sub-tab header when `editMode === true` and user is `admin` or `poi_admin`
- [ ] Clicking New opens the Sidebar in create mode with `poi_roles: ['point']` and `is_mtb_trail: true` pre-set
- [ ] Map enters "click to place" mode for coordinate selection
- [ ] Saving creates the POI with `is_mtb_trail = true`

**US-012-03: Create new Organization from Results > Organizations sub-tab**
> As an admin in edit mode viewing the Organizations sub-tab, I want to click "New" so that I can create a new organization POI.

Acceptance Criteria:
- [ ] "New" button appears in Organizations sub-tab header when `editMode === true` and user is `admin` or `poi_admin`
- [ ] Clicking New opens the Sidebar in create mode with `poi_roles: ['organization']` pre-set
- [ ] Coordinates are NOT required (organizations are virtual POIs)
- [ ] User can optionally upload a GeoJSON boundary file
- [ ] Saving creates the organization POI

### Results Tab — Role & GeoJSON Editing

**US-012-04: Edit POI roles during creation**
> As an admin creating a new POI, I want to add or remove roles so that a single POI can serve multiple purposes (e.g., a trailhead that is also a point of interest).

Acceptance Criteria:
- [ ] Role editor shows checkboxes/chips for all valid roles: point, trail, river, boundary, organization
- [ ] The default role from the sub-tab is pre-checked but can be unchecked
- [ ] At least one role must remain selected (validation)
- [ ] Role changes update what fields are visible in the edit form

**US-012-05: Upload GeoJSON for linear/boundary features**
> As an admin creating or editing a POI with trail, river, or boundary role, I want to upload a GeoJSON file so that the feature's geometry is stored.

Acceptance Criteria:
- [ ] GeoJSON upload field appears when the POI has a `trail`, `river`, or `boundary` role
- [ ] Accepts `.geojson` and `.json` files
- [ ] Validates that the file contains valid GeoJSON (Feature or FeatureCollection)
- [ ] Extracts geometry and stores in the `geometry` JSONB column
- [ ] Preview of the uploaded geometry renders on the map

**US-012-06: Click map to set coordinates for Point role POIs**
> As an admin creating a new POI with the `point` role, I want to click on the map to set the POI's location.

Acceptance Criteria:
- [ ] When creating a new point-role POI, the map shows a "Click to place" indicator
- [ ] Clicking the map sets latitude/longitude on the new POI
- [ ] A draggable marker appears at the clicked location
- [ ] Coordinates update in the Sidebar form in real-time
- [ ] Works with the existing `previewCoords` system in Map.jsx

### News Tab — New News Item

**US-012-07: Create new news item from News tab**
> As an admin in edit mode, I want to click "New" on the News tab so that I can manually create a news item for a POI.

Acceptance Criteria:
- [ ] "New" button appears in the News tab header when `editMode === true` and user is `admin`
- [ ] Clicking New opens an inline form (or modal) to create a news item
- [ ] Required fields: POI (select from list), title, summary
- [ ] Optional fields: source URL, source name, news type, publication date
- [ ] News item is created with `content_source: 'manual'` and `moderation_status: 'published'`
- [ ] New item appears in the news feed after creation

### Events Tab — New Event

**US-012-08: Create new event from Events tab**
> As an admin in edit mode, I want to click "New" on the Events tab so that I can manually create an event for a POI.

Acceptance Criteria:
- [ ] "New" button appears in the Events tab header when `editMode === true` and user is `admin`
- [ ] Clicking New opens an inline form (or modal) to create an event
- [ ] Required fields: POI (select from list), title, start date
- [ ] Optional fields: end date, description, event type, location details, source URL
- [ ] Event is created with `content_source: 'manual'` and `moderation_status: 'published'`
- [ ] New event appears in the events feed after creation

---

## Data Model

### Schema Changes

No new tables required. Minor additions to `POST /api/admin/pois`:

```sql
-- The existing pois table already supports all needed fields:
-- poi_roles TEXT[], latitude, longitude, geometry JSONB, is_mtb_trail BOOLEAN
-- No migration needed for POI creation.
```

New API endpoints needed for manual news/event creation (see API section).

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/admin/news` | Create manual news item | Admin |
| POST | `/api/admin/events` | Create manual event | Admin |

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| POST | `/api/admin/pois` | Add `is_mtb_trail` and `geometry` to allowed fields (if not already) |

---

## UI/UX Requirements

### New Components

- `RoleEditor` — Checkbox/chip selector for POI roles, used in Sidebar edit form during creation
- `GeoJSONUploader` — File input + validation + map preview for GeoJSON geometry uploads
- `NewNewsForm` — Inline form or modal for creating manual news items
- `NewEventForm` — Inline form or modal for creating manual events

### Modified Components

| Component | Changes |
|-----------|---------|
| `ResultsTab.jsx` | Add "New" button in header, visible when `editMode && (isAdmin \|\| role === 'poi_admin')` |
| `App.jsx` | Wire New button handlers for each sub-tab, pass `editMode` to ResultsTab |
| `Sidebar.jsx` | Accept pre-set `poi_roles` for new POI creation, add RoleEditor and GeoJSONUploader to edit form |
| `Map.jsx` | Support "click to place" mode triggered from Results tab (not just map right-click) |
| `ParkNews` (news tab component) | Add "New" button when admin + edit mode |
| `ParkEvents` (events tab component) | Add "New" button when admin + edit mode |

### Button Placement

```
┌─────────────────────────────────────────────┐
│  Results  │  News  │  Events  │  ...        │
├─────────────────────────────────────────────┤
│  POIs │ MTB Status │ Organizations  [+ New] │
│                                             │
│  (results list)                             │
└─────────────────────────────────────────────┘
```

The "New" button sits in the sub-tab bar area, right-aligned. On News/Events tabs it sits in the tab header area.

---

## Non-Functional Requirements

**NFR-012-01: Permission Safety**
- The New button must NEVER appear for non-admin users or when edit mode is off
- Backend endpoints must enforce role checks independently of frontend visibility

**NFR-012-02: Consistency**
- New POI creation via the Results tab must use the same Sidebar edit panel as the existing map-click creation flow
- The experience should feel like the same tool, just initiated from a different place

---

## Dependencies

- Depends on: 000-baseline (POI CRUD), 005-poi-roles (role system), 003-user-roles (admin permissions)
- Blocks: none

---

## Open Questions

1. Should the News/Events "New" forms be inline in the tab or open a modal? (Leaning modal for consistency with other creation flows)
2. For GeoJSON upload on existing POIs (not just new ones), should this be added to the standard edit form too? (Probably yes, but could be a follow-up)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-15 | Initial draft |
