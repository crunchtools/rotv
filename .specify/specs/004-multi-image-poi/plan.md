# Implementation Plan: Multiple Images per POI

> **Spec ID:** 004-multi-image-poi
> **Status:** Planning
> **Last Updated:** 2026-04-04
> **Estimated Effort:** L (Large - 4-6 days)

## Summary

Implement multi-image support by creating a `poi_media` junction table that links POIs to assets in the image server. Extend the moderation queue to handle media submissions. Build React components for mosaic display and lightbox viewer. Migrate existing primary images to the new schema.

**Design Decision:** Image server remains source of truth for asset storage (Option A). ROTV adds moderation/social layer via `poi_media` table.

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React)                                               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Mosaic     │  │  Lightbox    │  │ Upload Modal │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                  │                  │                 │
│         └──────────────────┴──────────────────┘                 │
│                            │                                    │
└────────────────────────────┼────────────────────────────────────┘
                             │ HTTP
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend (Node.js + Express)                                    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  /api/pois/:id/media                                      │  │
│  │  - Joins poi_media with image server asset metadata      │  │
│  │  - Returns mosaic (primary + 2 liked) + all media        │  │
│  └──────────────────┬───────────────────────────────────────┘  │
│                     │                                           │
│  ┌──────────────────▼───────────────────────────────────────┐  │
│  │  imageServerClient.js                                     │  │
│  │  - getAssetsByPoiId(poiId, role)                         │  │
│  │  - uploadImage/Video()                                   │  │
│  │  - fetchAssetData/Thumbnail()                            │  │
│  └──────────────────┬───────────────────────────────────────┘  │
│                     │                                           │
│  ┌──────────────────▼───────────────────────────────────────┐  │
│  │  PostgreSQL                                               │  │
│  │  - poi_media (poi_id, asset_id, media_type, role, ...)  │  │
│  │  - content_queue (moderation for media submissions)      │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────┼────────────────────────────────────────┘
                         │ HTTP (internal network)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Image Server (images.rootsofthevalley.org)                     │
│  - Storage: PostgreSQL (asset metadata) + filesystem (files)   │
│  - API: /api/assets (POST upload, GET retrieve)                │
│  - Roles: primary, gallery, theme                              │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

**Display Flow:**
1. User visits POI detail page → GET `/api/pois/:id/media`
2. Backend queries `poi_media` table for approved media
3. For each `image_server_asset_id`, backend fetches metadata from image server
4. Backend constructs mosaic array (primary + 2 most liked/recent)
5. Frontend renders `<Mosaic>` with 3 images
6. User clicks mosaic → `<Lightbox>` opens with all media

**Upload Flow (Regular User):**
1. User clicks "Add Photo" → `<MediaUploadModal>` opens
2. User selects file → POST `/api/pois/:id/media` with multipart form data
3. Backend uploads to image server → receives `asset_id`
4. Backend creates `poi_media` record with `approved_at = NULL`
5. Backend creates `content_queue` record with `poi_media_id`
6. User sees "Submitted for review" message

**Approval Flow (Admin):**
1. Admin visits moderation queue → GET `/api/admin/queue/media`
2. Admin clicks "Approve" → POST `/api/admin/queue/media/:id/approve`
3. Backend updates `poi_media.approved_at = NOW()`
4. Backend deletes `content_queue` record
5. Media now appears in public API responses

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Lightbox | Custom React component | Full control over UX, no external deps, <200 LOC |
| Image Lazy Loading | Intersection Observer API | Native browser support, performance |
| Video Player | HTML5 `<video>` | Native, no codec issues for MP4/WebM |
| YouTube Embeds | `<iframe>` with youtube-nocookie.com | Privacy-focused, standard embed |
| Drag-and-drop Reorder | react-beautiful-dnd | Accessible, battle-tested library |
| File Upload | FormData + fetch() | Standard, no library needed |

---

## Implementation Steps

### Phase 1: Database Schema

- [ ] Create migration `009_add_poi_media.sql`
- [ ] Define `poi_media` table with constraints
- [ ] Extend `content_queue` with `poi_media_id` column
- [ ] Create indexes for performance
- [ ] Write migration script to populate `poi_media` from existing primary images
- [ ] Test migration on local DB

### Phase 2: Backend API

- [ ] Extend `imageServerClient.js`:
  - [ ] `getAssetsByPoiId(poiId, role)` - query image server for POI's assets
  - [ ] `getAssetMetadata(assetId)` - get thumbnail/full URLs
- [ ] Create `/api/pois/:id/media` endpoint:
  - [ ] Query `poi_media` with `approved_at IS NOT NULL`
  - [ ] Join with image server asset data
  - [ ] Construct mosaic (primary + 2 liked, fallback to recent)
  - [ ] Return `{ mosaic: [...], all_media: [...], total_count: N }`
- [ ] Create `/api/pois/:id/media` POST endpoint:
  - [ ] Parse multipart form data (file or youtube_url)
  - [ ] Upload to image server
  - [ ] Create `poi_media` record
  - [ ] If user is admin → auto-approve, else → create queue item
- [ ] Create admin endpoints:
  - [ ] `DELETE /api/admin/poi-media/:id`
  - [ ] `PATCH /api/admin/poi-media/:id` (update role/sort_order)
  - [ ] `GET /api/admin/queue/media`
  - [ ] `POST /api/admin/queue/media/:id/approve`
  - [ ] `POST /api/admin/queue/media/:id/reject`

### Phase 3: Frontend Components

- [ ] Create `<Mosaic>` component:
  - [ ] CSS Grid layout (1 large + 2 small)
  - [ ] Responsive breakpoints (stacked on mobile)
  - [ ] Click handler → open lightbox
  - [ ] Placeholder for YouTube thumbnails
- [ ] Create `<Lightbox>` component:
  - [ ] Full-screen overlay with backdrop
  - [ ] Current media display (image/video/YouTube iframe)
  - [ ] Navigation arrows + keyboard handlers
  - [ ] Thumbnail strip at bottom
  - [ ] Close on ESC or backdrop click
- [ ] Create `<MediaUploadModal>` component:
  - [ ] Tabbed interface (Image/Video/YouTube)
  - [ ] File picker + drag-and-drop zone
  - [ ] Video size validation (warn if >10MB)
  - [ ] Upload progress indicator
  - [ ] Success/error toasts
- [ ] Integrate `<Mosaic>` into POI detail page
- [ ] Add "Add Photo" button (conditional on auth)

### Phase 4: Admin UI

- [ ] Create `<MediaManager>` admin component:
  - [ ] Grid view of all POI media
  - [ ] Drag-and-drop reordering (updates `sort_order`)
  - [ ] Set Primary button (updates `role`)
  - [ ] Delete button
- [ ] Extend moderation queue UI:
  - [ ] New "Media" tab
  - [ ] Thumbnail preview
  - [ ] Approve/Reject actions

### Phase 5: Testing & Polish

- [ ] Write backend tests:
  - [ ] POST `/api/pois/:id/media` (upload flow)
  - [ ] GET `/api/pois/:id/media` (mosaic construction)
  - [ ] Admin approval flow
- [ ] Write frontend tests:
  - [ ] Mosaic rendering (1, 2, 3+ images)
  - [ ] Lightbox navigation
  - [ ] Upload validation
- [ ] Manual testing:
  - [ ] Upload image → verify in queue → approve → see in mosaic
  - [ ] Upload video <10MB → plays in lightbox
  - [ ] YouTube embed → displays in lightbox
  - [ ] Admin reorder → mosaic updates
- [ ] Accessibility audit:
  - [ ] Keyboard navigation in lightbox
  - [ ] Alt text for images
  - [ ] Screen reader announcements

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/009_add_poi_media.sql` | Database schema for poi_media table |
| `backend/scripts/migrate-primary-images.js` | One-time migration of existing primary images |
| `frontend/src/components/Mosaic.jsx` | Mosaic display component |
| `frontend/src/components/Lightbox.jsx` | Full-screen media viewer |
| `frontend/src/components/MediaUploadModal.jsx` | Media upload interface |
| `frontend/src/components/admin/MediaManager.jsx` | Admin media management UI |
| `backend/tests/api/poi-media.test.js` | API tests for media endpoints |
| `frontend/src/components/__tests__/Mosaic.test.jsx` | Component tests |

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/imageServerClient.js` | Add `getAssetsByPoiId()`, `getAssetMetadata()` |
| `backend/routes/api.js` | Add `/api/pois/:id/media` endpoints |
| `backend/routes/admin.js` | Add admin media management endpoints |
| `backend/services/moderationService.js` | Extend to handle media queue items |
| `frontend/src/components/POIDetail.jsx` | Integrate `<Mosaic>` component |
| `frontend/src/components/admin/ModerationQueue.jsx` | Add media tab |

---

## Database Migrations

**Migration: 009_add_poi_media.sql**

```sql
-- Migration 009: Add multi-image support via poi_media junction table

CREATE TABLE poi_media (
    id SERIAL PRIMARY KEY,
    poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
    media_type VARCHAR(20) NOT NULL,

    -- For images/videos: reference to image server asset
    image_server_asset_id VARCHAR(255),

    -- For YouTube embeds: the URL
    youtube_url TEXT,

    -- Display metadata
    role VARCHAR(20) DEFAULT 'gallery',
    sort_order INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,

    -- Moderation
    uploaded_by INTEGER,
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
CREATE UNIQUE INDEX idx_poi_media_unique_primary ON poi_media(poi_id) WHERE role = 'primary';

-- Extend content_queue to support media submissions
ALTER TABLE content_queue ADD COLUMN poi_media_id INTEGER REFERENCES poi_media(id) ON DELETE CASCADE;

-- Populate poi_media from existing primary images
-- This will be done by a separate migration script that queries the image server
```

**Migration Script: migrate-primary-images.js**

```javascript
// One-time migration to populate poi_media from existing primary images
// Run after migration 009

const { pool } = require('../db');
const imageServerClient = require('../services/imageServerClient');

async function migratePrimaryImages() {
  const result = await pool.query('SELECT id FROM pois WHERE has_primary_image = true');
  const pois = result.rows;

  for (const poi of pois) {
    // Query image server for existing primary asset
    const asset = await imageServerClient.getPrimaryAsset(poi.id);

    if (asset) {
      await pool.query(`
        INSERT INTO poi_media (poi_id, media_type, image_server_asset_id, role, approved_at, sort_order)
        VALUES ($1, 'image', $2, 'primary', NOW(), 0)
        ON CONFLICT DO NOTHING
      `, [poi.id, asset.id]);

      console.log(`Migrated primary image for POI ${poi.id}: asset ${asset.id}`);
    } else {
      console.warn(`No primary asset found for POI ${poi.id} (has_primary_image=true)`);
    }
  }

  console.log('Migration complete');
}

migratePrimaryImages().catch(console.error);
```

---

## API Implementation

### Endpoint: `GET /api/pois/:id/media`

**Logic:**
1. Query `poi_media` WHERE `poi_id = :id AND approved_at IS NOT NULL`
2. For each media:
   - If `media_type = 'image' | 'video'`: Fetch asset metadata from image server
   - If `media_type = 'youtube'`: Extract video ID, construct thumbnail URL
3. Sort for mosaic: `role='primary' DESC, likes_count DESC, created_at DESC LIMIT 3`
4. Return `{ mosaic: [...], all_media: [...], total_count: N }`

**Request:**
```
GET /api/pois/123/media
```

**Response:**
```json
{
  "mosaic": [
    {
      "id": 456,
      "media_type": "image",
      "asset_id": "abc123",
      "role": "primary",
      "thumbnail_url": "/api/assets/abc123/thumbnail",
      "full_url": "/api/assets/abc123/original",
      "likes_count": 0,
      "created_at": "2026-03-01T10:00:00Z"
    },
    {
      "id": 457,
      "media_type": "image",
      "asset_id": "def456",
      "role": "gallery",
      "thumbnail_url": "/api/assets/def456/thumbnail",
      "full_url": "/api/assets/def456/original",
      "likes_count": 8,
      "created_at": "2026-03-15T14:30:00Z"
    },
    {
      "id": 458,
      "media_type": "youtube",
      "youtube_url": "https://www.youtube.com/watch?v=xyz",
      "role": "gallery",
      "thumbnail_url": "https://img.youtube.com/vi/xyz/maxresdefault.jpg",
      "likes_count": 3,
      "created_at": "2026-03-20T09:15:00Z"
    }
  ],
  "all_media": [ /* all approved media, not just mosaic */ ],
  "total_count": 15
}
```

### Endpoint: `POST /api/pois/:id/media`

**Logic:**
1. Parse multipart form data or JSON body
2. Validate: `media_type`, file size (<10MB for video), YouTube URL format
3. If `media_type = 'image' | 'video'`:
   - Upload to image server → receive `asset_id`
4. Create `poi_media` record:
   - If user is admin → `approved_at = NOW()`, `approved_by = user.id`
   - Else → `approved_at = NULL`, create `content_queue` item
5. Return success message

**Request (Image/Video Upload):**
```
POST /api/pois/123/media
Content-Type: multipart/form-data

file: [binary]
media_type: "image"
```

**Request (YouTube Link):**
```
POST /api/pois/123/media
Content-Type: application/json

{
  "media_type": "youtube",
  "youtube_url": "https://www.youtube.com/watch?v=xyz"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Image submitted for review",
  "media_id": 459,
  "queue_item_id": 789
}
```

---

## Testing Strategy

### Unit Tests

- [ ] `backend/tests/services/imageServerClient.test.js`
  - Test `getAssetsByPoiId()` with mocked image server responses
  - Test `getAssetMetadata()` for image/video/YouTube
- [ ] `backend/tests/api/poi-media.test.js`
  - Test GET `/api/pois/:id/media` returns correct mosaic
  - Test POST upload creates queue item for regular users
  - Test POST auto-approves for admins
  - Test video size validation (reject >10MB)
  - Test YouTube URL validation

### Integration Tests

- [ ] `backend/tests/integration/media-workflow.test.js`
  - End-to-end: Upload → Approve → Display in mosaic
  - Admin uploads bypass queue
  - Mosaic prioritizes primary + liked images

### Frontend Tests

- [ ] `frontend/src/components/__tests__/Mosaic.test.jsx`
  - Renders 1 image (full width)
  - Renders 2 images (split)
  - Renders 3+ images (mosaic layout)
  - Click opens lightbox
- [ ] `frontend/src/components/__tests__/Lightbox.test.jsx`
  - Displays current media
  - Prev/next navigation works
  - ESC closes lightbox
  - Thumbnail click jumps to media

### Manual Testing

1. **Upload Flow:**
   - Log in as regular user → upload image to POI → verify in moderation queue
   - Log in as admin → approve image → verify appears in POI mosaic
2. **Mosaic Display:**
   - POI with 1 image → full width
   - POI with 2 images → split layout
   - POI with 3+ images → 1 large + 2 small
3. **Lightbox:**
   - Click mosaic → lightbox opens
   - Navigate with arrows → images change
   - Press ESC → lightbox closes
   - Play video → HTML5 player works
   - YouTube embed → iframe loads
4. **Admin Management:**
   - Reorder media → mosaic updates
   - Set different primary image → mosaic shows new primary
   - Delete media → removed from display

---

## Rollback Plan

If issues are discovered post-deployment:

1. **Rollback code:**
   - `git revert <commit-hash>` to remove feature
   - Redeploy previous version
2. **Database rollback:**
   - `DROP TABLE poi_media CASCADE;` (removes all multi-image data)
   - `ALTER TABLE content_queue DROP COLUMN poi_media_id;`
   - Existing POIs with `has_primary_image=true` continue to work via old `/api/pois/:id/image` endpoint
3. **Image server:**
   - No rollback needed - assets remain in image server
   - Can be re-imported if feature is re-enabled

**Note:** Migration is reversible because we don't delete `has_primary_image` column.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Image server unavailable during migration | High | Run migration script during low-traffic window (2-4 AM) |
| Large POI media count slows page load | Medium | Implement pagination for `all_media` (return first 50, load more on scroll) |
| Video playback issues (codec support) | Low | Recommend MP4/H.264 format, provide transcoding guide in docs |
| YouTube embeds blocked by privacy extensions | Low | Use youtube-nocookie.com, provide fallback "Watch on YouTube" link |
| Mosaic layout breaks on narrow screens | Medium | Responsive CSS with mobile-first design, tested on 320px+ viewports |
| Admins accidentally delete primary image | Medium | Soft delete (add `deleted_at` column), admin UI warns "This is the primary image" |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-04-04 | Initial plan with architecture, phases, and detailed implementation steps |
