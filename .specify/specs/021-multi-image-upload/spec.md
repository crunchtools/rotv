# Specification: Multi-Image Upload

> **Spec ID:** 021-multi-image-upload
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-22
> **Issue:** [#390](https://github.com/crunchtools/rotv/issues/390)

## Overview

Today the media upload modal accepts only one file per submission, forcing
users to repeat the entire pick → preview → upload flow for every photo. This
feature lets a contributor select several images at once: regular users may
batch up to **3 images**, and admins (`admin` / `media_admin`) may select an
**unlimited** number. Video and YouTube remain single-item flows.

---

## User Stories

### Contributor Uploads

**US-001: Batch image selection (regular user)**
> As a signed-in contributor, I want to select up to three images in one go so
> that I can share a small set of photos without repeating the upload flow.

Acceptance Criteria:
- [ ] On the Image tab, the file picker allows selecting multiple files.
- [ ] A regular user may stage at most 3 images; attempting more shows a clear
      message and the extra files are not added.
- [ ] Each staged image shows a thumbnail preview and a per-image remove control.
- [ ] Uploading submits all staged images; each lands in the moderation queue
      exactly as a single upload does today.

**US-002: Unlimited batch (admin)**
> As an admin or media_admin, I want to select as many images as I need at once
> so that I can populate a POI gallery quickly.

Acceptance Criteria:
- [ ] An admin/media_admin user is not capped at 3 images.
- [ ] The cap message does not appear for admins.

**US-003: Per-image upload feedback**
> As a user uploading a batch, I want to see progress and know which images
> succeeded so that I can retry only what failed.

Acceptance Criteria:
- [ ] During upload, progress is shown (e.g. "Uploading 2 of 3…").
- [ ] If some images fail, the modal reports how many succeeded and which failed,
      and leaves the failed ones staged for retry.
- [ ] If all succeed, the modal closes and the gallery refreshes (current behavior).

### Unchanged Flows

**US-004: Video and YouTube stay single**
> As a user, I expect the Video and YouTube tabs to behave exactly as before.

Acceptance Criteria:
- [ ] Video tab accepts one file (≤10MB) as today.
- [ ] YouTube tab accepts one URL as today.

---

## Data Model

No schema changes. Each image is one `poi_media` row, inserted by the existing
`POST /api/pois/:id/media` endpoint.

---

## API Endpoints

No new endpoints. The frontend calls the existing single-file endpoint once per
image:

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/pois/:id/media` | Upload one image/video or add a YouTube link (unchanged) | Authenticated |

**Decision — client-side sequential upload, not `upload.array`:** The role cap
is a UX guardrail, not a security boundary. A user can already upload unlimited
images today by repeating single submissions, so a server-enforced per-batch
cap would add a duplicated multi-file code path (moderation status, asset
rollback, mosaic cache invalidation) without preventing anything. Looping over
the proven single-file endpoint keeps the change small and the backend
untouched.

---

## UI/UX Requirements

### Modified Components

- `MediaUploadModal` — Image tab becomes multi-select: staged-file list with
  per-image thumbnail + remove, role-based cap, batch upload with progress and
  partial-failure reporting. Video/YouTube tabs unchanged.

### Role Source

`useAuth()` already exposes `isAdmin` and `user`. The modal reads `isAdmin` to
decide the cap (3 vs unlimited).

### Caption Behavior

**Decision (per #390 review):** each staged image carries its own optional
caption input in the staged-file list. The per-image caption is sent with that
image's POST, preserving the existing single-image caption behavior for every
item in a batch.

---

## Non-Functional Requirements

**NFR-001: No regression**
- Single-image, video, and YouTube uploads behave identically to today.
- Existing moderation queue, asset rollback, and mosaic-cache invalidation are
  reused unchanged (one invocation per image).

**NFR-002: Bounded client work**
- Regular users are capped at 3; admin batches are sequential, so memory and
  network stay bounded to one in-flight upload at a time.

---

## Dependencies

- Builds on spec 005-era multi-image POI support (Issue #181 / PR #182):
  `poi_media` table, `MediaUploadModal`, role-based moderation.

---

## Resolved Decisions

1. Captions: **per-image** optional caption input in the staged list (#390 review).
2. Regular-user cap: **hard-coded constant** `MAX_REGULAR = 3` (#390 review).

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-22 | Initial draft |
