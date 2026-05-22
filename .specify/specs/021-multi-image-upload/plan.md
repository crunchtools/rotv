# Implementation Plan: Multi-Image Upload

> **Spec ID:** 021-multi-image-upload
> **Status:** Planning
> **Last Updated:** 2026-05-22
> **Estimated Effort:** S

## Summary

Convert the Image tab of `MediaUploadModal` from single-file to multi-file
selection, capped at 3 for regular users and unlimited for admins, and upload
the staged images sequentially through the existing
`POST /api/pois/:id/media` endpoint. No backend or database changes.

---

## Architecture

### Data Flow

1. User opens the modal, selects N images on the Image tab (picker `multiple`).
2. Files are validated (type/size, same rules as today) and the cap is enforced
   client-side using `isAdmin` from `useAuth()`.
3. Staged images render as a thumbnail list with per-item remove.
4. On Upload, the modal POSTs each image to `/api/pois/:id/media` in sequence,
   updating "Uploading i of N…".
5. Successes are tallied; failures stay staged with an aggregated error message.
6. If all succeed: `onSuccess()` + `onClose()` (unchanged); the gallery/mosaic
   refreshes via the existing cache invalidation per upload.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Role gate | `useAuth().isAdmin` | Already the app-wide source of admin state |
| Upload | Sequential `fetch` to existing endpoint | Reuses proven moderation + rollback path; no new backend surface |

---

## Implementation Steps

### Phase 1: Modal state refactor (Image tab only)

- [ ] Replace single `selectedFile`/`preview` with a `selectedImages` array of
      `{ file, preview, id, caption }` (Video/YouTube keep their single-file state).
- [ ] Import and use `useAuth()` to read `isAdmin`; define `MAX_REGULAR = 3`.
- [ ] `handleFileSelect` accepts a `FileList`, validates each, enforces the cap
      (reject overflow with a message), and appends valid images.
- [ ] Per-image remove; show count (e.g. "2 / 3 selected" for regular users).

### Phase 2: Batch upload

- [ ] `handleUpload` for the Image tab loops over `selectedImages`, awaiting each
      POST; track `succeeded`/`failed` and current index for progress text.
- [ ] Each image's own `caption` is sent with its POST.
- [ ] On partial failure, keep failed images staged, surface
      "X uploaded, Y failed" and the first error.

### Phase 3: Markup + styles

- [ ] Replace the single preview block with the staged-image list/grid.
- [ ] Add minimal CSS to `MediaUploadModal.css` for the multi-image list.
- [ ] Keep the `multiple` attribute on the image file input only.

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/MediaUploadModal.jsx` | Multi-select state, cap, staged list, sequential batch upload, conditional caption |
| `frontend/src/components/MediaUploadModal.css` | Styles for the staged-image list/grid |

### Unchanged

- `backend/server.js` `POST /api/pois/:id/media` — no signature or logic change.
- `poi_media` schema — no migration.

---

## Testing Strategy

### Manual Testing

1. As a regular user: select 4 images → only 3 stage, message shown; remove one,
   add another; upload → all land in moderation queue; gallery refreshes.
2. As admin: select 6 images → all stage; upload → all succeed.
3. Single image → caption field appears and is saved.
4. Video tab: one file ≤10MB still works; >10MB rejected. YouTube tab unchanged.
5. Force a mid-batch failure (e.g. oversized file slipping through) → modal
   reports partial success and keeps the failed item staged.

### Automated

- Existing `backend/tests/poiMedia.integration.test.js` continues to cover the
  endpoint (unchanged). No backend test changes expected; add a frontend
  component test only if the existing suite already exercises this modal.

---

## Rollback Plan

Frontend-only change. Revert the two files / the PR commit; no data or schema to
unwind.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Partial-batch failure leaves user confused | Med | Explicit "X of N uploaded" message; failed items remain staged for retry |
| Client-only cap is bypassable | Low | Accepted — single uploads are already unlimited by repetition; cap is UX, not security (see spec) |
| Caption semantics for batches | Low | Caption hidden unless exactly one image staged |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-22 | Initial plan |
