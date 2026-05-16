# Implementation Plan: Editable About Page

> **Spec ID:** 013-editable-about
> **Status:** Planning
> **Last Updated:** 2026-05-15
> **Estimated Effort:** M

## Summary

Store About page text content (Story, Tutorial intro, Privacy Policy) as markdown in the `admin_settings` table. Add a public GET endpoint and an admin PUT endpoint. On the frontend, add `marked` + `DOMPurify` for rendering and a simple textarea editor triggered by an Edit button when in admin edit mode.

---

## Architecture

### Data Flow

1. Migration seeds current hardcoded content as markdown into `admin_settings`
2. `GET /api/about-content` reads all three keys in one query
3. Frontend fetches on About page mount, caches in state
4. `marked` renders markdown to HTML, `DOMPurify` sanitizes it
5. Admin clicks Edit -> textarea with raw markdown -> Save -> `PUT /api/admin/about-content/:key` -> re-fetch

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Markdown parser | `marked` | Lightweight (~40KB), zero deps, widely used, already proven pattern |
| HTML sanitizer | `DOMPurify` | Industry standard XSS prevention for user-authored HTML |

---

## Implementation Steps

### Phase 1: Database Migration

- [ ] Create `backend/migrations/018_about_content.sql`
- [ ] INSERT default markdown for `about_story_md`, `about_tutorial_md`, `about_privacy_md` using `ON CONFLICT DO NOTHING`
- [ ] Convert current JSX content to equivalent markdown for seeding

### Phase 2: Backend API

- [ ] Add `GET /api/about-content` route (public, no auth)
- [ ] Add `PUT /api/admin/about-content/:key` route (admin only)
- [ ] Validate `:key` against allowlist of three keys
- [ ] Wire routes into Express app

### Phase 3: Frontend Dependencies

- [ ] `npm install marked dompurify` in frontend
- [ ] Create a small `MarkdownRenderer` component that wraps marked + DOMPurify

### Phase 4: AboutPage Refactor

- [ ] Fetch `/api/about-content` on mount
- [ ] Replace `AboutStory` hardcoded JSX with MarkdownRenderer
- [ ] Replace `AboutTutorial` intro text with MarkdownRenderer (keep Tour button)
- [ ] Replace `PrivacyPolicy` hardcoded JSX with MarkdownRenderer
- [ ] Add Edit button + textarea editor for each tab (visible when admin + editMode)
- [ ] Save handler calls PUT endpoint, updates local state

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/018_about_content.sql` | Seed default markdown content |
| `frontend/src/components/MarkdownRenderer.jsx` | Shared marked + DOMPurify wrapper |

### Modified Files

| File | Changes |
|------|---------|
| `backend/routes/admin.js` | Add PUT `/admin/about-content/:key` |
| `backend/server.js` or routes index | Add GET `/api/about-content` |
| `frontend/src/components/AboutPage.jsx` | Fetch content, render markdown, add edit UI |
| `frontend/src/components/PrivacyPolicy.jsx` | Accept markdown content as prop, use MarkdownRenderer |
| `frontend/package.json` | Add `marked`, `dompurify` |

---

## Database Migrations

```sql
-- Migration: 018_about_content
-- Seed About page content into admin_settings

INSERT INTO admin_settings (key, value) VALUES
('about_story_md', '...markdown...'),
('about_tutorial_md', '...markdown...'),
('about_privacy_md', '...markdown...')
ON CONFLICT (key) DO NOTHING;
```

---

## API Implementation

### GET /api/about-content

```sql
SELECT key, value FROM admin_settings WHERE key IN ('about_story_md', 'about_tutorial_md', 'about_privacy_md');
```

Returns JSON object with all three keys.

### PUT /api/admin/about-content/:key

```sql
INSERT INTO admin_settings (key, value) VALUES ($1, $2)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

---

## Testing Strategy

### Integration Tests

- [ ] GET `/api/about-content` returns all three keys after migration
- [ ] PUT `/api/admin/about-content/about_story_md` updates content (admin auth)
- [ ] PUT `/api/admin/about-content/bad_key` returns 400
- [ ] PUT without admin auth returns 401/403

### Manual Testing

1. Open About page as visitor - see rendered Story, Tutorial, Privacy
2. Log in as admin, enable edit mode - see Edit buttons on all three tabs
3. Click Edit on Story tab - see markdown textarea
4. Modify, save - see updated rendered content
5. Refresh page - content persists
6. Check `/privacy` standalone route still works

---

## Rollback Plan

1. Revert the frontend changes (About page renders hardcoded content again)
2. Migration is additive only (INSERT ON CONFLICT DO NOTHING) - safe to leave in place

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| XSS from admin-authored markdown | Med | DOMPurify sanitization on render |
| Large markdown content in admin_settings | Low | Text column has no practical limit; about page content is small |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-15 | Initial plan |
