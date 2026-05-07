# Specification: Shareable Permalink URLs for News & Events

> **Spec ID:** 007-shareable-permalinks
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-03

## Overview

Add dedicated permalink URLs for individual news and event items so they can be shared on social media with proper Open Graph meta tags. When a user pastes a ROTV news or event link into X, Facebook, iMessage, or Slack, the platform renders a rich preview with the title, summary, and image. A share button on the site uses the Web Share API for native OS sharing on mobile, with a copy-link fallback on desktop.

---

## User Stories

### Sharing

**US-001: Share a news article via permalink**
> As a visitor, I want to share a specific news article by URL so that others can see it directly without navigating through the map.

Acceptance Criteria:
- [ ] `/news/:id/:slug` renders a standalone page for the news item
- [ ] The page includes OG meta tags (og:title, og:description, og:image, og:url)
- [ ] Link previews render correctly on X, Facebook, iMessage, and Slack
- [ ] Slug mismatch redirects (301) to the canonical URL

**US-002: Share an event via permalink**
> As a visitor, I want to share a specific event by URL so that I can invite others to attend.

Acceptance Criteria:
- [ ] `/events/:id/:slug` renders a standalone page for the event
- [ ] The page includes OG meta tags with event-specific details (date, location)
- [ ] Slug mismatch redirects (301) to the canonical URL

**US-003: Share from the site using native sharing**
> As a mobile user, I want to tap a share button and use my phone's native share sheet so that I can share to any app without leaving the site.

Acceptance Criteria:
- [ ] Share button visible on news/event cards in the list view
- [ ] Share button visible on the permalink page
- [ ] Mobile: triggers Web Share API with title, text, and URL
- [ ] Desktop fallback: copies the permalink URL to clipboard with confirmation toast

### Navigation

**US-004: Navigate from permalink to POI on map**
> As a visitor arriving via a shared link, I want to see where this news/event is located so that I can explore the area.

Acceptance Criteria:
- [ ] Permalink page shows the POI name as a link
- [ ] Clicking the POI name navigates to the map centered on that POI
- [ ] "Back to map" navigation is available

---

## Data Model

### Schema Changes

No database changes required. News and event items already have all needed fields (id, title, summary/description, source_url, poi_id, publication_date, news_type/event_type).

A slug generation utility derives the slug from the title at render time (no stored column needed).

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/news/:id/:slug` | Render news permalink page with OG tags | No |
| GET | `/events/:id/:slug` | Render event permalink page with OG tags | No |
| GET | `/api/news/:id` | JSON API for news item detail | No |
| GET | `/api/events/:id` | JSON API for event item detail | No |

### Redirect Behavior

- `/news/:id` (no slug) redirects 301 to `/news/:id/:correct-slug`
- `/news/:id/:wrong-slug` redirects 301 to `/news/:id/:correct-slug`
- `/news/:id/:correct-slug` renders the page (200)

---

## UI/UX Requirements

### Permalink Page

- Title and publication date
- Full summary/description
- Source attribution with link to original article
- POI name with link back to map view
- Share button
- News type or event type badge

### Share Button

- Icon-only button (share icon) on news/event cards in list view
- Full "Share" button on permalink pages
- Mobile: Web Share API → native OS share sheet
- Desktop: Copy permalink to clipboard → toast notification "Link copied!"

---

## Non-Functional Requirements

**NFR-001: SEO & Social**
- OG meta tags must be server-side rendered (not client-side JS) so crawlers and link preview bots can read them
- Canonical URL must be set via `og:url` and `<link rel="canonical">`

**NFR-002: Performance**
- Permalink pages should load in under 1 second
- No full React app bootstrap needed — lightweight server-rendered HTML with optional React hydration

---

## Dependencies

- Depends on: 000-baseline (existing news/events infrastructure)
- Blocks: None

---

## Resolved Questions

1. **Hero image source:** Use the source article's OG image (fetched and cached during news collection). Fall back to POI image if no source OG image is available.
2. **Twitter card tags:** Yes, include `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image` alongside OG tags for better X previews.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-03 | Initial draft |
