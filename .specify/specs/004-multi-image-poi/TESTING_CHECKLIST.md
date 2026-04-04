# Manual Testing Checklist: Multi-Image POI Support

**Date:** 2026-04-04
**Feature:** Issue #181 - Multiple Images per POI with Mosaic Display and Lightbox
**Branch:** `feature/181-multi-image-poi`

---

## Prerequisites

- [ ] Container is running (`./run.sh start`)
- [ ] Migration 015 applied (`psql -U postgres -d rotv -f backend/migrations/015_add_poi_media.sql`)
- [ ] Primary images migrated (`node backend/scripts/migrate-primary-images.js`)
- [ ] Test user account created (or use existing admin account)
- [ ] Image server running (images.rootsofthevalley.org or local)

---

## 1. Database Migration ✓

**Goal:** Verify migration created correct schema

- [ ] `poi_media` table exists with correct columns:
  ```sql
  \d poi_media
  ```
  - [ ] `id`, `poi_id`, `media_type`, `image_server_asset_id`, `youtube_url`
  - [ ] `role`, `sort_order`, `likes_count`, `caption`
  - [ ] `moderation_status`, `submitted_by`, `moderated_by`, `moderated_at`
  - [ ] `created_at`

- [ ] Indexes created:
  ```sql
  \di poi_media*
  ```
  - [ ] `idx_poi_media_poi_id`
  - [ ] `idx_poi_media_role`
  - [ ] `idx_poi_media_likes`
  - [ ] `idx_poi_media_created`
  - [ ] `idx_poi_media_moderation`
  - [ ] `idx_poi_media_unique_primary`

- [ ] Constraints work:
  ```sql
  -- Should fail (invalid media_type):
  INSERT INTO poi_media (poi_id, media_type) VALUES (1, 'invalid');

  -- Should fail (missing asset_id for image):
  INSERT INTO poi_media (poi_id, media_type) VALUES (1, 'image');

  -- Should succeed:
  INSERT INTO poi_media (poi_id, media_type, youtube_url)
  VALUES (1, 'youtube', 'https://youtube.com/watch?v=test');
  ```

- [ ] Moderation queue view includes media:
  ```sql
  SELECT * FROM moderation_queue WHERE content_type = 'photo' LIMIT 5;
  ```

---

## 2. Image Upload (Unauthenticated User)

**Goal:** Verify upload button hidden for non-logged-in users

- [ ] Navigate to any POI detail page
- [ ] Verify "Add Photo/Video" button is **NOT visible**
- [ ] Open browser console, verify no auth errors

---

## 3. Image Upload (Authenticated Regular User)

**Goal:** Verify regular users can upload to queue

### Setup
- [ ] Log in as regular user (not admin)
- [ ] Navigate to POI with existing images

### Upload Image
- [ ] Click "Add Photo/Video" button
- [ ] Modal opens with 3 tabs: Image, Video, YouTube
- [ ] Select "Image" tab (should be default)
- [ ] **Test drag-and-drop:**
  - [ ] Drag an image file over dropzone
  - [ ] Dropzone highlights (blue border)
  - [ ] Drop file
  - [ ] Preview appears
  - [ ] File info shows name and size
- [ ] Click "Remove" to clear preview
- [ ] **Test file picker:**
  - [ ] Click dropzone to open file picker
  - [ ] Select a JPEG image (<10MB)
  - [ ] Preview appears
- [ ] Add caption: "Test image upload"
- [ ] Click "Upload"
- [ ] Success message appears: "Image submitted for review"
- [ ] Modal closes automatically after 1.5s
- [ ] Image does **NOT** appear in mosaic yet (pending approval)

### Upload Video
- [ ] Click "Add Photo/Video" button
- [ ] Select "Video" tab
- [ ] Upload a video <10MB (MP4/WebM)
- [ ] Caption: "Test video upload"
- [ ] Click "Upload"
- [ ] Success message: "Video submitted for review"

### Upload Large Video (>10MB)
- [ ] Click "Add Photo/Video" button
- [ ] Select "Video" tab
- [ ] Upload a video >10MB
- [ ] Error appears: "Video must be less than 10MB. Please upload to YouTube instead."
- [ ] Upload fails (not sent to server)

### Add YouTube Link
- [ ] Click "Add Photo/Video" button
- [ ] Select "YouTube" tab
- [ ] Enter URL: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- [ ] Caption: "Test YouTube embed"
- [ ] Click "Upload"
- [ ] Success message: "YouTube video submitted for review"

### Validation
- [ ] Try uploading without selecting file: Upload button disabled
- [ ] Try uploading invalid file type (e.g., .txt): Error message appears
- [ ] Try YouTube tab with empty URL: Error "Please enter a YouTube URL"
- [ ] Try YouTube tab with invalid URL: Error "Invalid YouTube URL"

---

## 4. Media Admin Upload (Auto-Approve)

**Goal:** Verify media admins bypass queue

- [ ] Log in as **media_admin** or **admin** role user
- [ ] Navigate to any POI
- [ ] Upload an image
- [ ] Success message: "Media uploaded and published"
- [ ] **Immediately** refresh page or close/reopen POI
- [ ] New image appears in mosaic (auto-approved)

---

## 5. Mosaic Display

**Goal:** Verify mosaic renders correctly with different media counts

### No Media
- [ ] Navigate to POI with no media
- [ ] Default thumbnail appears (based on POI type)
- [ ] No mosaic component visible

### Single Image
- [ ] Navigate to POI with exactly 1 approved image
- [ ] Image displays full-width (no mosaic grid)
- [ ] Click image → lightbox opens

### Two Images
- [ ] Navigate to POI with exactly 2 approved images
- [ ] Images display in 2-column split layout
- [ ] Both images same height
- [ ] Click either image → lightbox opens

### Three+ Images
- [ ] Navigate to POI with 3+ approved images
- [ ] Mosaic displays: 1 large left, 2 stacked right (Facebook style)
- [ ] Primary image appears in mosaic (if exists)
- [ ] If >3 images: "+N" overlay appears on third image
- [ ] Click any image → lightbox opens

### Media Type Indicators
- [ ] POI with video: Play icon overlay appears on thumbnail
- [ ] POI with YouTube: YouTube icon overlay appears
- [ ] POI with mixed media: Correct icon on each thumbnail

### Responsive Design
- [ ] **Desktop (>768px):**
  - [ ] 3-image mosaic: 1 large left, 2 stacked right
  - [ ] Aspect ratio: 4:3 for each image
- [ ] **Mobile (<768px):**
  - [ ] All images stacked vertically
  - [ ] Aspect ratio: 16:9 (wider on mobile)
  - [ ] No horizontal scroll

---

## 6. Lightbox Viewer

**Goal:** Verify lightbox functions correctly

### Basic Navigation
- [ ] Click mosaic → lightbox opens
- [ ] Current image displays at correct index
- [ ] Counter shows "N / Total" (e.g., "1 / 5")
- [ ] Prev/next arrows visible (if >1 media)
- [ ] Thumbnail strip visible at bottom (if >1 media)
- [ ] Close button (X) visible in top-right

### Keyboard Navigation
- [ ] Press **Left Arrow** → previous media
- [ ] Press **Right Arrow** → next media
- [ ] Press **ESC** → lightbox closes
- [ ] Press **TAB** → focus moves to controls

### Mouse Navigation
- [ ] Click **Next Arrow** → next media
- [ ] Click **Prev Arrow** → previous media
- [ ] Click **Close (X)** → lightbox closes
- [ ] Click **thumbnail** in strip → jumps to that media
- [ ] Click **backdrop** (dark area outside content) → lightbox closes

### Wrap-Around
- [ ] Navigate to last image → click next → wraps to first
- [ ] Navigate to first image → click prev → wraps to last

### Image Display
- [ ] Image loads at full resolution
- [ ] Image fits within viewport (no cropping)
- [ ] Image maintains aspect ratio
- [ ] Caption displays below image (if exists)

### Video Playback
- [ ] Navigate to video media item
- [ ] HTML5 video player appears
- [ ] Controls visible (play, pause, volume, fullscreen)
- [ ] Click play → video plays
- [ ] Video auto-plays when navigating to it (optional behavior)

### YouTube Embed
- [ ] Navigate to YouTube media item
- [ ] YouTube iframe player appears
- [ ] Video title visible in iframe
- [ ] Click play → YouTube video plays
- [ ] YouTube controls work (play, pause, seek, fullscreen)

### Mobile Lightbox
- [ ] Open lightbox on mobile device (<768px)
- [ ] Swipe left → next media
- [ ] Swipe right → previous media
- [ ] Pinch to zoom (if supported)
- [ ] Tap backdrop → lightbox closes

---

## 7. Admin Moderation Queue

**Goal:** Verify photo moderation tab works with poi_media

### Access Queue
- [ ] Log in as admin
- [ ] Navigate to Admin Panel → Moderation Queue
- [ ] "Photos" tab is present (alongside News, Events)

### View Pending Media
- [ ] Click "Photos" tab
- [ ] Pending media submissions appear
- [ ] Each item shows:
  - [ ] Thumbnail preview
  - [ ] POI name
  - [ ] Uploader email (if available)
  - [ ] Upload date
  - [ ] Media type indicator (image/video/YouTube)

### Approve Media
- [ ] Select a pending media item
- [ ] Click "Approve" button
- [ ] Item disappears from pending list
- [ ] Navigate to the POI → media now appears in mosaic

### Reject Media
- [ ] Select a pending media item
- [ ] Click "Reject" button
- [ ] Optional: Enter rejection reason
- [ ] Item disappears from pending list
- [ ] Navigate to POI → media does NOT appear

### Bulk Actions
- [ ] Select multiple pending media (checkboxes)
- [ ] Click "Bulk Approve"
- [ ] All selected items approved
- [ ] Verify POIs now show approved media

---

## 8. Admin Media Management (via API)

**Goal:** Verify admin CRUD operations work

### List All Media
```bash
curl -X GET http://localhost:8080/admin/poi-media \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"
```
- [ ] Returns JSON array of all media
- [ ] Each item has: id, poi_id, media_type, role, moderation_status

### Update Media Role
```bash
curl -X PATCH http://localhost:8080/admin/poi-media/1 \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"role": "primary"}'
```
- [ ] Returns success
- [ ] Navigate to POI → new primary image appears first in mosaic

### Update Caption
```bash
curl -X PATCH http://localhost:8080/admin/poi-media/1 \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"caption": "Updated caption text"}'
```
- [ ] Returns success
- [ ] Open lightbox → caption updated

### Soft Delete
```bash
curl -X DELETE http://localhost:8080/admin/poi-media/1 \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"
```
- [ ] Returns success
- [ ] Navigate to POI → media no longer appears
- [ ] Database: `moderation_status = 'rejected'`

### Hard Delete
```bash
curl -X DELETE "http://localhost:8080/admin/poi-media/1?permanent=true" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"
```
- [ ] Returns success
- [ ] Database: Row deleted from `poi_media`
- [ ] Image server: Asset deleted (if image/video)

---

## 9. Backward Compatibility

**Goal:** Verify existing functionality still works

### Legacy Single Image Endpoint
```bash
curl http://localhost:8080/api/pois/1/image
```
- [ ] Returns primary image (if exists)
- [ ] Queries `poi_media` table with `role='primary'`

### Legacy Thumbnail Endpoint
```bash
curl http://localhost:8080/api/pois/1/thumbnail
```
- [ ] Returns primary thumbnail (if exists)

### POIs Without Media
- [ ] Navigate to POI with `has_primary_image = false`
- [ ] Default thumbnail appears (based on POI type)
- [ ] No errors in console

### Old Photo Submissions
- [ ] Check database: `photo_submissions` table still exists
- [ ] Migration 015 should have copied data to `poi_media`
- [ ] Old submissions appear in moderation queue (as type 'photo')

---

## 10. Performance & Loading

**Goal:** Verify acceptable performance

### Mosaic Load Time
- [ ] Navigate to POI with 10+ images
- [ ] Mosaic loads within **500ms** (check Network tab)
- [ ] Thumbnails load progressively (not blocking)

### Lightbox Lazy Loading
- [ ] Open lightbox on POI with 20+ images
- [ ] Only current image + adjacent images load immediately
- [ ] Navigating to new image triggers load (lazy)

### Video Upload
- [ ] Upload 8MB video
- [ ] Upload completes within **5 seconds**
- [ ] Progress indicator visible (if implemented)
- [ ] No UI blocking

---

## 11. Error Handling

**Goal:** Verify graceful error handling

### Network Errors
- [ ] Disconnect network
- [ ] Try uploading media
- [ ] Error message: "Failed to upload"
- [ ] Reconnect → retry succeeds

### Image Server Down
- [ ] Stop image server (if local)
- [ ] Navigate to POI
- [ ] Mosaic shows "Loading media..." then falls back to default thumbnail
- [ ] No broken image icons
- [ ] Console warning: "Image server not configured"

### Invalid API Responses
- [ ] Mock invalid JSON response from `/api/pois/:id/media`
- [ ] Mosaic handles gracefully (shows default or empty state)
- [ ] No uncaught errors in console

---

## 12. Accessibility

**Goal:** Verify keyboard and screen reader support

### Keyboard Navigation
- [ ] Tab through mosaic images: Each image focusable
- [ ] Press Enter on focused image: Lightbox opens
- [ ] Tab through lightbox controls: All buttons focusable
- [ ] Escape closes lightbox: Works correctly

### Screen Reader
- [ ] Use screen reader (NVDA/JAWS/VoiceOver)
- [ ] Mosaic images have alt text: Read aloud correctly
- [ ] Lightbox navigation announced: "Previous", "Next", "Close"
- [ ] Counter announced: "Image 3 of 10"
- [ ] Media type announced: "Video", "YouTube embed"

### Focus Management
- [ ] Open lightbox → focus moves to lightbox
- [ ] Close lightbox → focus returns to mosaic
- [ ] No focus traps (can Tab out if needed)

---

## 13. Cross-Browser Testing

**Goal:** Verify works in major browsers

### Chrome/Edge (Chromium)
- [ ] Mosaic displays correctly
- [ ] Lightbox works
- [ ] Upload modal works
- [ ] Videos play

### Firefox
- [ ] Mosaic displays correctly
- [ ] Lightbox works
- [ ] Upload modal works
- [ ] Videos play

### Safari (macOS/iOS)
- [ ] Mosaic displays correctly
- [ ] Lightbox works
- [ ] Upload modal works
- [ ] Videos play
- [ ] YouTube embeds work

### Mobile Chrome (Android)
- [ ] Responsive mosaic (stacked)
- [ ] Lightbox swipe gestures work
- [ ] Upload modal usable
- [ ] File picker works

### Mobile Safari (iOS)
- [ ] Responsive mosaic (stacked)
- [ ] Lightbox swipe gestures work
- [ ] Upload modal usable
- [ ] File picker works

---

## 14. Security

**Goal:** Verify security controls

### Authentication Required
- [ ] POST /api/pois/:id/media → 401 without auth
- [ ] All admin endpoints → 403 without admin role

### Role-Based Access
- [ ] Regular user can upload (creates queue item)
- [ ] Media admin upload auto-approves
- [ ] Only admins can approve/reject via API

### Input Validation
- [ ] YouTube URL validation: Rejects invalid URLs
- [ ] Media type validation: Rejects invalid types
- [ ] File size validation: Rejects >10MB videos

### SQL Injection Prevention
```bash
curl -X GET "http://localhost:8080/api/pois/1' OR '1'='1/media"
```
- [ ] Returns 404 or error (not 200 with all media)

### XSS Prevention
- [ ] Upload image with caption: `<script>alert('XSS')</script>`
- [ ] Approve and view in lightbox
- [ ] Caption displays as text (not executed as script)

---

## 15. Edge Cases

**Goal:** Verify handles unusual scenarios

### Empty States
- [ ] POI with no media: Default thumbnail appears
- [ ] Lightbox with 1 media: No prev/next arrows
- [ ] Mosaic with 0 approved: Shows upload button only

### Large Media Counts
- [ ] POI with 100+ images: Mosaic shows 3, lightbox works
- [ ] Lightbox thumbnail strip scrollable
- [ ] Performance acceptable (no lag)

### Special Characters
- [ ] Upload image with filename: `test (1) [copy].jpg`
- [ ] Caption with emojis: `Beautiful sunset 🌅`
- [ ] YouTube URL with query params: `?v=id&t=30s&feature=share`
- [ ] All render correctly

### Concurrent Uploads
- [ ] Open 3 browser tabs
- [ ] Upload different images from each tab simultaneously
- [ ] All uploads succeed
- [ ] All appear in queue

---

## Summary Checklist

**Core Functionality:**
- [ ] Database migration successful
- [ ] Image upload works (queue for users, auto-approve for admins)
- [ ] Video upload works (<10MB, warning >10MB)
- [ ] YouTube embed works
- [ ] Mosaic displays correctly (1/2/3+ images)
- [ ] Lightbox opens and navigation works
- [ ] Moderation queue "Photos" tab works
- [ ] Admin can approve/reject media
- [ ] Keyboard navigation works
- [ ] Mobile responsive

**Quality:**
- [ ] No console errors
- [ ] No broken images
- [ ] Acceptable load times (<500ms mosaic, <5s upload)
- [ ] Cross-browser compatible
- [ ] Accessible (keyboard, screen reader)
- [ ] Secure (auth, validation, no XSS/SQLi)

**Backward Compatibility:**
- [ ] Legacy `/api/pois/:id/image` works
- [ ] POIs without media show default thumbnails
- [ ] Old `photo_submissions` data migrated

---

**Testing Completed By:** _________________
**Date:** _________________
**Issues Found:** _________________
**Status:** ☐ Pass ☐ Pass with Minor Issues ☐ Fail
