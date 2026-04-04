# Specification: Multiple Images per POI

> **Spec ID:** 004-multi-image-poi
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-04-04

## Overview

Enable POIs to support multiple images, videos, and YouTube embeds instead of a single primary image. Display media in a Facebook-style mosaic (1 large + 2 small) and provide a lightbox viewer for browsing all media. Integrate with the moderation queue to allow community contributions while maintaining quality control.

This transforms ROTV from a single-image reference into a rich visual discovery platform aligned with the "stories and curiosity" positioning.

---

## User Stories

### Content Discovery

**US-004-01: View Multiple POI Images**
> As a visitor, I want to see multiple photos of a POI so that I can assess seasonal conditions, different angles, and amenities before visiting.

Acceptance Criteria:
- [ ] POI detail page displays up to 3 images in a mosaic layout (1 large + 2 small)
- [ ] Mosaic shows primary image + 2 most-liked images (fallback to most recent)
- [ ] Mosaic adapts to image count (1 image = full width, 2 = split, 3+ = mosaic)
- [ ] Clicking mosaic opens lightbox viewer

**US-004-02: Browse Media in Lightbox**
> As a visitor, I want to click on the photo mosaic and browse all images/videos in a lightbox so I can explore the location visually without leaving the POI detail view.

Acceptance Criteria:
- [ ] Lightbox displays all approved media (images, videos, YouTube embeds)
- [ ] Navigation: prev/next arrows, keyboard controls, thumbnail strip
- [ ] Videos play inline (direct uploads <10MB)
- [ ] YouTube embeds display as embedded player
- [ ] Lightbox closes on ESC key or click outside
- [ ] Responsive on mobile and desktop

### Content Contribution

**US-004-03: Upload POI Media**
> As a regular user, I want to upload photos or videos from my hike so I can help others discover the trail.

Acceptance Criteria:
- [ ] Upload button visible on POI detail page (when logged in)
- [ ] Upload modal accepts: images (JPEG/PNG/WebP), videos (<10MB), YouTube URLs
- [ ] Warning shown if video >10MB: "Large videos? Upload to YouTube instead"
- [ ] Uploads enter moderation queue with status 'pending'
- [ ] User receives confirmation message

**US-004-04: Admin Media Approval**
> As an Image Admin or Full Admin, I want to approve community-submitted photos so I can maintain content quality while enabling user contributions.

Acceptance Criteria:
- [ ] Moderation queue shows pending media submissions
- [ ] Each submission shows: thumbnail, uploader, POI name, upload date
- [ ] Approve/Reject buttons with optional rejection reason
- [ ] Admins can upload directly (bypasses queue)
- [ ] Approval increments POI media count

### Admin Management

**US-004-05: Manage POI Media**
> As an admin, I want to reorder, delete, or change the primary image so I can curate the visual presentation of each POI.

Acceptance Criteria:
- [ ] Admin UI shows all POI media in sortable grid
- [ ] Drag-and-drop to reorder (updates `sort_order`)
- [ ] Set primary image (updates `role`)
- [ ] Delete media (soft delete or permanent)
- [ ] Changes reflected immediately in UI

---

## Data Model

### New Tables

| Table | Description |
|-------|-------------|
| `poi_media` | Junction table linking POIs to images/videos/YouTube embeds |

### Schema: poi_media

```sql
CREATE TABLE poi_media (
    id SERIAL PRIMARY KEY,
    poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
    media_type VARCHAR(20) NOT NULL, -- 'image', 'video', 'youtube'

    -- For images/videos: reference to image server asset
    image_server_asset_id VARCHAR(255),

    -- For YouTube embeds: the URL
    youtube_url TEXT,

    -- Display metadata
    role VARCHAR(20) DEFAULT 'gallery', -- 'primary', 'gallery'
    sort_order INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0, -- Reserved for UX 1.0 (Issue #141)

    -- Moderation
    uploaded_by INTEGER, -- NULL for admin-uploaded or migrated content
    approved_at TIMESTAMP,
    approved_by INTEGER,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT media_type_check CHECK (media_type IN ('image', 'video', 'youtube')),
    CONSTRAINT role_check CHECK (role IN ('primary', 'gallery')),
    CONSTRAINT asset_or_url CHECK (
        (media_type = 'youtube' AND youtube_url IS NOT NULL AND image_server_asset_id IS NULL) OR
        (media_type IN ('image', 'video') AND image_server_asset_id IS NOT NULL AND youtube_url IS NULL)
    )
);

CREATE INDEX idx_poi_media_poi_id ON poi_media(poi_id);
CREATE INDEX idx_poi_media_role ON poi_media(poi_id, role);
CREATE INDEX idx_poi_media_likes ON poi_media(poi_id, likes_count DESC);
CREATE INDEX idx_poi_media_created ON poi_media(poi_id, created_at DESC);

-- One primary image per POI
CREATE UNIQUE INDEX idx_poi_media_unique_primary ON poi_media(poi_id)
    WHERE role = 'primary';
```

### Migration: Existing Primary Images

Existing POIs with `has_primary_image = true` should be migrated:

```sql
-- Populate poi_media from existing primary images
INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, role, approved_at, sort_order)
SELECT
    p.id,
    'image',
    -- Query image server for existing asset_id by poi_id + role='primary'
    -- This will be done programmatically in migration script
    NULL, -- Placeholder, will be populated by migration script
    'primary',
    NOW(), -- All existing images are auto-approved
    0
FROM pois p
WHERE p.has_primary_image = true;
```

### Schema Changes: content_queue

Extend moderation queue to support media submissions:

```sql
ALTER TABLE content_queue
    ADD COLUMN poi_media_id INTEGER REFERENCES poi_media(id) ON DELETE CASCADE;

-- Allow NULL for existing columns when this is a media submission
ALTER TABLE content_queue
    ALTER COLUMN content_type DROP NOT NULL;
```

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/pois/:id/media` | List all approved media for a POI | No |
| POST | `/api/pois/:id/media` | Upload media (image/video/YouTube) | User |
| DELETE | `/api/admin/poi-media/:id` | Delete media | Admin |
| PATCH | `/api/admin/poi-media/:id` | Update role/sort_order | Admin |
| GET | `/api/admin/queue/media` | Get pending media submissions | Admin |
| POST | `/api/admin/queue/media/:id/approve` | Approve media | Admin |
| POST | `/api/admin/queue/media/:id/reject` | Reject media | Admin |

### Endpoint Details

**GET /api/pois/:id/media**

Returns all approved media for display in mosaic and lightbox.

```json
{
  "mosaic": [
    {
      "id": 123,
      "media_type": "image",
      "asset_id": "abc123",
      "role": "primary",
      "thumbnail_url": "/api/assets/abc123/thumbnail",
      "full_url": "/api/assets/abc123/original",
      "likes_count": 0
    },
    {
      "id": 124,
      "media_type": "image",
      "asset_id": "def456",
      "role": "gallery",
      "thumbnail_url": "/api/assets/def456/thumbnail",
      "full_url": "/api/assets/def456/original",
      "likes_count": 5
    },
    {
      "id": 125,
      "media_type": "youtube",
      "youtube_url": "https://www.youtube.com/watch?v=xyz",
      "role": "gallery",
      "thumbnail_url": "https://img.youtube.com/vi/xyz/maxresdefault.jpg",
      "likes_count": 2
    }
  ],
  "all_media": [...], // All approved media for lightbox
  "total_count": 15
}
```

**POST /api/pois/:id/media**

Upload media. Regular users → moderation queue. Admins → auto-approved.

Request (multipart/form-data):
```
file: [binary] (for image/video)
media_type: "image" | "video" | "youtube"
youtube_url: "https://..." (if media_type=youtube)
```

Response:
```json
{
  "success": true,
  "message": "Image submitted for review",
  "queue_item_id": 456
}
```

**PATCH /api/admin/poi-media/:id**

Update media metadata (role, sort_order).

Request:
```json
{
  "role": "primary",
  "sort_order": 1
}
```

---

## UI/UX Requirements

### New Components

**Mosaic Component** (`frontend/src/components/Mosaic.jsx`)
- Renders 1-3 images in Facebook-style layout
- Responsive grid: desktop (1 large + 2 small), mobile (stacked)
- Click handler opens lightbox

**Lightbox Component** (`frontend/src/components/Lightbox.jsx`)
- Full-screen overlay with media viewer
- Supports images, videos (HTML5 player), YouTube embeds (iframe)
- Navigation: prev/next arrows, thumbnail strip at bottom
- Keyboard: left/right arrows, ESC to close
- Touch gestures on mobile: swipe left/right

**Media Upload Modal** (`frontend/src/components/MediaUploadModal.jsx`)
- Tabbed interface: "Upload Image", "Upload Video", "Add YouTube Link"
- File picker with drag-and-drop
- Video size warning if >10MB
- Progress indicator during upload
- Success/error messages

**Admin Media Manager** (`frontend/src/components/admin/MediaManager.jsx`)
- Grid view of all POI media
- Sortable (drag-and-drop)
- Actions: Set Primary, Delete, Reorder
- Inline thumbnail preview

### Layout Mockup

```
┌──────────────────────────────────────────────────────┐
│  POI Detail Page                                     │
│                                                      │
│  [POI Name]                                          │
│  [Description]                                       │
│                                                      │
│  ┌────────────────┬──────────┐                      │
│  │                │          │                      │
│  │   PRIMARY      │  Image 2 │  ← Mosaic (clickable)│
│  │   (large)      │──────────│                      │
│  │                │  Image 3 │                      │
│  └────────────────┴──────────┘                      │
│                                                      │
│  [More POI content...]                               │
└──────────────────────────────────────────────────────┘

Lightbox (on click):
┌──────────────────────────────────────────────────────┐
│  [X]                                          [Close]│
│                                                      │
│         ┌────────────────────────────┐              │
│   [<]   │   Current Image/Video      │   [>]        │
│         │   (full resolution)        │              │
│         └────────────────────────────┘              │
│                                                      │
│  [thumb][thumb][thumb][thumb][thumb][thumb]          │
└──────────────────────────────────────────────────────┘
```

---

## Non-Functional Requirements

**NFR-004-01: Performance**
- Mosaic loads within 500ms (thumbnail size optimization)
- Lightbox lazy-loads images as user navigates
- No UI blocking during upload (<5s for 10MB video)

**NFR-004-02: Storage**
- No hard limit on media count per POI (like Google Maps)
- UI prioritizes ~20 most recent/liked images
- Video uploads capped at 10MB (enforced client + server)

**NFR-004-03: Accessibility**
- Keyboard navigation in lightbox (arrows, ESC, TAB)
- Alt text for all images (from image server metadata)
- Screen reader announcements for media transitions

**NFR-004-04: Backward Compatibility**
- Existing single-image POIs continue to work
- Migration script populates `poi_media` from existing primary images
- API `/api/pois/:id/image` unchanged (returns primary from poi_media)

---

## Dependencies

- **Depends on:** Image server (images.rootsofthevalley.org) - already deployed (Issue #97, #104)
- **Depends on:** Existing moderation queue (`content_queue` table) - already implemented (Migration 002)
- **Blocks:** UX 1.0 Phase 4 - Community Submissions (Issue #141)

---

## Open Questions

~~1. **Image limit per POI**: Should there be a max (e.g., 20 images)?~~
   - **Resolved:** No hard limit (like Google Maps). UI prioritizes ~20 recent/liked.

~~2. **YouTube URL handling**: Store as separate `media_links` table or inline in `poi_images` with `media_type`?~~
   - **Resolved:** Unified `poi_media` table with `media_type` discriminator.

~~3. **Video upload**: Should users be able to upload videos directly, or only link to YouTube?~~
   - **Resolved:** Both. Direct upload <10MB with warning, YouTube embeds allowed.

~~4. **Mosaic prioritization**: Should primary image always show in mosaic, or use most recent approved images?~~
   - **Resolved:** Primary + 2 most liked (fallback to most recent if likes not yet implemented).

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-04-04 | Initial draft with resolved design decisions |
