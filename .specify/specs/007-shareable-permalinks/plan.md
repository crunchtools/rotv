# Implementation Plan: Shareable Permalink URLs for News & Events

> **Spec ID:** 007-shareable-permalinks
> **Status:** Planning
> **Last Updated:** 2026-05-03
> **Estimated Effort:** M

## Summary

Add server-rendered permalink pages for news and events with OG meta tags for social sharing. The Express backend serves HTML with embedded meta tags for crawler/bot requests, while the React frontend handles interactive rendering. A share button uses the Web Share API with clipboard fallback.

---

## Architecture

### Request Flow

```
Browser/Bot → Express Router
                 │
                 ├── /news/:id/:slug  → server.js renders HTML with OG tags
                 ├── /events/:id/:slug → server.js renders HTML with OG tags
                 ├── /api/news/:id    → JSON response (React fetches this)
                 └── /api/events/:id  → JSON response (React fetches this)
```

### OG Tag Strategy

Social media crawlers (Facebook, X, Slack, iMessage) do NOT execute JavaScript. OG tags must be in the initial HTML response. Two approaches:

**Chosen approach: Server-rendered HTML template**
Express serves a minimal HTML page with OG meta tags in the `<head>` and a React mount point in the `<body>`. The React app hydrates and fetches the full item via the JSON API. This avoids SSR complexity while ensuring crawlers get the meta tags they need.

---

## Implementation Steps

### Phase 1: Backend API + Server-Rendered Pages

- [ ] Add `/api/news/:id` and `/api/events/:id` JSON endpoints
- [ ] Add slug generation utility (title → kebab-case slug)
- [ ] Add `/news/:id/:slug` and `/events/:id/:slug` routes that serve HTML with OG tags
- [ ] Handle slug redirects (missing or wrong slug → 301 to canonical)
- [ ] Include `twitter:card` summary tags alongside OG tags

### Phase 2: Frontend Permalink Page

- [ ] Add React route for `/news/:id/:slug` and `/events/:id/:slug`
- [ ] Create `NewsPermalink` component (fetches from JSON API, renders full item)
- [ ] Create `EventPermalink` component (same pattern)
- [ ] Add "Back to map" / POI link navigation
- [ ] Add share button component with Web Share API + clipboard fallback

### Phase 3: Share Button on List Views

- [ ] Add share icon button to news cards in the News list view
- [ ] Add share icon button to event cards in the Events list view
- [ ] Toast notification for clipboard copy confirmation

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/NewsPermalink.jsx` | Permalink page for a single news item |
| `frontend/src/components/EventPermalink.jsx` | Permalink page for a single event |
| `frontend/src/components/ShareButton.jsx` | Reusable share button (Web Share API + fallback) |

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | Add permalink routes, JSON API endpoints, OG HTML template |
| `frontend/src/App.jsx` | Add React Router routes for `/news/:id/:slug` and `/events/:id/:slug` |
| `frontend/src/components/NewsEventsShared.jsx` | Add share button to news/event cards |

---

## Database Migrations

None required. Existing `poi_news` and `poi_events` tables have all needed columns.

---

## Testing Strategy

### Integration Tests

- [ ] Permalink route returns 200 with OG meta tags in HTML
- [ ] Wrong slug returns 301 redirect to correct slug
- [ ] Missing item returns 404
- [ ] JSON API returns correct item data
- [ ] Only published/auto_approved items are accessible (no pending/rejected)

### Manual Testing

1. Share a news permalink on X — verify card preview shows title, description
2. Share an event permalink in Slack — verify unfurl shows event details
3. Test share button on mobile — verify native share sheet appears
4. Test share button on desktop — verify clipboard copy + toast

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Crawlers don't see OG tags | High | Server-render HTML with tags in `<head>`, not client-side JS |
| Slug generation inconsistency | Low | Derive slug at render time from title, always redirect to canonical |
| Performance of permalink page | Low | Lightweight HTML template, React hydration is progressive |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-03 | Initial plan |
