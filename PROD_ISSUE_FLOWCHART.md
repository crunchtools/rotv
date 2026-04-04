# Production Issue Flowchart (PR #182)

## Issue Flow: "Failed to load image"

```
User clicks POI on map
        ↓
Frontend: Sidebar.jsx loads
        ↓
API Call #1: GET /api/pois/${id}/media
        ↓
Backend: server.js:1008-1086
        ↓
    Query: SELECT * FROM poi_media WHERE poi_id = $1
        ↓
    Result: [] (empty - table has no rows)
        ↓
    Response: { mosaic: [], all_media: [], total_count: 0 }
        ↓
Frontend receives empty media array
        ↓
Checks: media.length > 0?  → NO
        ↓
Checks: has_primary_image = true?  → YES (database flag still set)
        ↓
Fallback: Load single image via legacy endpoint
        ↓
API Call #2: GET /api/pois/${id}/thumbnail
        ↓
Backend: server.js:957-997 (CHANGED IN PR #182)
        ↓
    OLD CODE (before PR #182):
        ↓
        Query image server directly
        ↓
        Return image data

    NEW CODE (PR #182):
        ↓
        Query: SELECT image_server_asset_id
               FROM poi_media
               WHERE poi_id = $1 AND role = 'primary'
        ↓
        Result: [] (empty - no rows!)
        ↓
        Return 404: "Image not found"
        ↓
        ❌ ERROR: "Failed to load image"
```

---

## Root Cause Diagram

```
PR #182 Changed Image Serving Logic
        ↓
┌───────────────────────────────────────────────────┐
│ BEFORE: Direct image server queries              │
│                                                   │
│ /api/pois/:id/thumbnail                          │
│   → imageServerClient.getPrimaryAsset(poiId)     │
│   → Fetch from image server                      │
│   → Return image                                  │
└───────────────────────────────────────────────────┘
        ↓
┌───────────────────────────────────────────────────┐
│ AFTER: Database-backed with poi_media table      │
│                                                   │
│ /api/pois/:id/thumbnail                          │
│   → SELECT FROM poi_media WHERE role='primary'   │
│   → Get image_server_asset_id                    │
│   → Fetch from image server using assetId        │
│   → Return image                                  │
└───────────────────────────────────────────────────┘
        ↓
┌───────────────────────────────────────────────────┐
│ REQUIRED: poi_media table must be populated      │
│                                                   │
│ Migration 015: ✅ Creates table structure        │
│ Migration script: ❌ Populates with data          │
│                       (NOT RUN IN PROD)           │
└───────────────────────────────────────────────────┘
        ↓
    RESULT: 404 errors on all image requests
```

---

## What Should Have Happened (Deployment Steps)

```
1. ✅ Merge PR #182
2. ✅ GHA builds new container
3. ✅ Backup database
4. ✅ Apply migration 015 (creates poi_media table)
5. ❌ Run migrate-primary-images.js ← SKIPPED
6. ❌ Apply migration 016 (data integrity) ← MAYBE SKIPPED
7. ✅ Pull new container
8. ✅ Restart service
9. ❌ Verify images load ← WOULD HAVE CAUGHT THIS
```

**Missing:** Steps 5, 6, and 9 from deployment runbook

---

## Data Flow (When Working Correctly)

```
Database: pois table
┌─────────────────────────────────────────┐
│ id │ name          │ has_primary_image │
├────┼───────────────┼───────────────────┤
│ 1  │ Trailhead A   │ true              │
│ 2  │ Historical B  │ true              │
└─────────────────────────────────────────┘
        ↓
Migration Script: migrate-primary-images.js
        ↓
    1. Queries image server for primary assets
    2. For each POI with has_primary_image=true
    3. Creates record in poi_media table
        ↓
Database: poi_media table
┌────────────────────────────────────────────────────────────┐
│ poi_id │ role    │ image_server_asset_id │ moderation   │
├────────┼─────────┼───────────────────────┼──────────────┤
│ 1      │ primary │ abc123                │ published    │
│ 2      │ primary │ def456                │ published    │
└────────────────────────────────────────────────────────────┘
        ↓
API: GET /api/pois/1/thumbnail
        ↓
    SELECT image_server_asset_id FROM poi_media
    WHERE poi_id = 1 AND role = 'primary'
        ↓
    Result: 'abc123'
        ↓
    Fetch from image server: /api/assets/abc123/thumbnail
        ↓
    Return image data to browser
        ↓
    ✅ Image displays
```

---

## Current Broken State

```
Database: pois table
┌─────────────────────────────────────────┐
│ id │ name          │ has_primary_image │
├────┼───────────────┼───────────────────┤
│ 1  │ Trailhead A   │ true              │ ← Flag still set
│ 2  │ Historical B  │ true              │
└─────────────────────────────────────────┘
        ↓
❌ Migration script NOT RUN
        ↓
Database: poi_media table
┌────────────────────────────────────────────────────────────┐
│ poi_id │ role    │ image_server_asset_id │ moderation   │
├────────┼─────────┼───────────────────────┼──────────────┤
│ (empty)│         │                       │              │ ← NO DATA
└────────────────────────────────────────────────────────────┘
        ↓
API: GET /api/pois/1/thumbnail
        ↓
    SELECT image_server_asset_id FROM poi_media
    WHERE poi_id = 1 AND role = 'primary'
        ↓
    Result: [] (no rows)
        ↓
    Return 404: "Image not found"
        ↓
    ❌ "Failed to load image" error in browser
```

---

## Fix Flow

```
Run: migrate-primary-images.js
        ↓
    1. Queries: SELECT id FROM pois WHERE has_primary_image = true
        ↓
       Found: [1, 2, 3, ..., 75]
        ↓
    2. For each POI:
        ↓
       a. Check if already has primary in poi_media
          → Skip if exists (prevents duplicates)
        ↓
       b. Fetch primary asset from image server
          → GET http://10.89.1.100:8000/api/assets?poi_id=1&role=primary
        ↓
       c. Create poi_media record
          → INSERT INTO poi_media (poi_id, role, image_server_asset_id, ...)
             VALUES (1, 'primary', 'abc123', ...)
        ↓
    3. Summary:
       ✓ Migrated: 75
       ✓ Skipped: 0 (already exists)
       ✓ Failed: 0 (no asset found)
        ↓
Database: poi_media now populated
        ↓
Restart service
        ↓
Images load correctly ✅
```

---

## Verification Flow

```
1. Database Check
   ↓
   podman exec rootsofthevalley.org psql -U postgres -d rotv \
     -c "SELECT COUNT(*) FROM poi_media WHERE role='primary';"
   ↓
   Expected: 75 (or number of POIs with images)
   ↓
2. API Check
   ↓
   curl https://rootsofthevalley.org/api/pois/1/media
   ↓
   Expected: { "mosaic": [...], "all_media": [...], "total_count": N }
   ↓
3. Frontend Check
   ↓
   Open browser → Click POI
   ↓
   Expected: Images display, no console errors
   ↓
   ✅ Fix verified
```

---

## Key Files Changed in PR #182

### Backend Changes
- `backend/server.js:957-997` - Thumbnail endpoint now queries `poi_media`
- `backend/server.js:1008-1086` - New media endpoint
- `backend/server.js:1229-1299` - Asset proxy endpoints
- `backend/migrations/015_add_poi_media.sql` - Creates table
- `backend/migrations/016_fix_poi_media_constraints.sql` - Data integrity
- `backend/scripts/migrate-primary-images.js` - Populates table

### Frontend Changes
- `frontend/src/components/Sidebar.jsx:232-241` - Calls new media endpoint
- `frontend/src/components/Mosaic.jsx` - New component
- `frontend/src/components/Lightbox.jsx` - New component
- `frontend/src/components/MediaUploadModal.jsx` - New component

---

## Migration Dependencies

```
Migration 015 (SQL)
    ↓
Creates poi_media table structure
    ↓
Migration Script (Node.js)
    ↓
Populates poi_media with data from image server
    ↓
Migration 016 (SQL)
    ↓
Adds data integrity constraints
    ↓
Service Restart
    ↓
New code can serve images from poi_media
```

**Critical:** Steps must be done in order. Migration script depends on table existing (015) but should be run before constraints (016) to avoid validation errors during bulk insert.

---

## Why This Wasn't Caught Earlier

1. **Local testing:** Uses ephemeral database in container
   - Migration script runs as part of build
   - Always starts fresh
   - Would work correctly in dev

2. **CI/CD:** Doesn't test against production database
   - Can't verify data migration
   - Only tests code, not deployment

3. **Deployment:** Manual steps
   - Runbook exists but steps were skipped
   - No automated verification

4. **Solution:** Add post-deployment smoke tests
   - Check table counts
   - Test key API endpoints
   - Verify sample POI loads
