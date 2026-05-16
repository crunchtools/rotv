# Specification: Editable About Page

> **Spec ID:** 013-editable-about
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-15

## Overview

Make the About page's text tabs (Story, Tutorial, Privacy Policy) admin-editable using markdown stored in the database. Admins see an "Edit" button that opens a markdown editor; changes render as HTML for all visitors. This follows the same pattern as inline POI field editing in the Sidebar.

---

## User Stories

### Admin Content Management

**US-013-1: Edit Story Content**
> As an admin, I want to edit the Story tab content in markdown so that I can update the ROTV narrative without code changes.

Acceptance Criteria:
- [ ] Admin sees an "Edit" button on the Story tab
- [ ] Clicking Edit reveals a markdown textarea with the current content
- [ ] Saving persists the markdown to the database
- [ ] Non-admin visitors see the rendered HTML (no edit button)

**US-013-2: Edit Tutorial Content**
> As an admin, I want to edit the Tutorial tab intro text so that I can update onboarding copy without a deploy.

Acceptance Criteria:
- [ ] Admin sees an "Edit" button on the Tutorial tab
- [ ] The "Take a Tour" button remains functional and is not part of the editable content
- [ ] Markdown is saved and rendered the same way as Story

**US-013-3: Edit Privacy Policy**
> As an admin, I want to edit the Privacy Policy in markdown so that I can keep it current as the project evolves.

Acceptance Criteria:
- [ ] Admin sees an "Edit" button on the Privacy Policy tab
- [ ] The standalone `/privacy` route also renders the database-backed content
- [ ] Markdown is saved and rendered the same way as Story

**US-013-4: Seed Default Content**
> As a developer, I want the current hardcoded content to be the default seed so that the migration is seamless.

Acceptance Criteria:
- [ ] Migration inserts current Story, Tutorial, and Privacy text as markdown
- [ ] If admin_settings rows already exist for these keys, they are not overwritten
- [ ] App renders identically before and after the migration (no visual regression)

---

## Data Model

### Schema Changes

Uses the existing `admin_settings` table (key/value pattern already in use for GitHub tokens, feature flags, etc.).

New keys:

| Key | Value |
|-----|-------|
| `about_story_md` | Markdown content for the Story tab |
| `about_tutorial_md` | Markdown content for the Tutorial tab intro |
| `about_privacy_md` | Markdown content for the Privacy Policy tab |

No new tables required.

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/about-content` | Returns all three markdown blobs as JSON | No |
| PUT | `/api/admin/about-content/:key` | Updates a single about content key | Admin |

### GET /api/about-content

Response:
```json
{
  "about_story_md": "## One Map for Everything...",
  "about_tutorial_md": "## Learn How ROTV Works...",
  "about_privacy_md": "# Privacy Policy..."
}
```

### PUT /api/admin/about-content/:key

Request:
```json
{
  "content": "## Updated markdown content..."
}
```

`:key` must be one of: `about_story_md`, `about_tutorial_md`, `about_privacy_md`.

---

## UI/UX Requirements

### Markdown Library

Add `marked` (lightweight, zero-dependency markdown parser) to the frontend. Uses **GitHub Flavored Markdown (GFM)** — the same syntax as GitHub READMEs, issues, and comments.

### Editing Pattern

- When `isAdmin && editMode`, show an "Edit" button in the top-right of each tab's content area
- Clicking Edit replaces the rendered HTML with a `<textarea>` containing raw markdown
- Save/Cancel buttons appear below the textarea
- A "Markdown Guide" link below the textarea opens GitHub's markdown reference in a new tab
- Save calls `PUT /api/admin/about-content/:key` and re-renders
- Textarea auto-resizes to fit content (same pattern as Sidebar POI editing)

### Rendering

- All visitors see markdown rendered as HTML via `marked`
- Sanitize output with `DOMPurify` to prevent XSS from admin-authored markdown
- Links open in new tab (`target="_blank"`)

---

## Non-Functional Requirements

**NFR-013-1: Security**
- Markdown output must be sanitized before rendering (DOMPurify)
- Only admin role can write; the PUT endpoint uses `isAdmin` middleware
- GET endpoint is public (content is public information)

**NFR-013-2: Performance**
- About content is fetched once when the About page opens, not on every tab switch
- No loading spinners needed for sub-100ms queries

---

## Dependencies

- Depends on: existing `admin_settings` table, existing `AuthContext` and `isAdmin` middleware
- Blocks: nothing

---

## Open Questions

None — the pattern is well-established in this codebase.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-15 | Initial draft |
