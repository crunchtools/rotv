# Implementation Plan: Progressive Web App (PWA) Support

> **Spec ID:** 028-pwa
> **Status:** In Progress
> **Last Updated:** 2026-05-27
> **Estimated Effort:** S

## Summary

Add a web app manifest, minimal service worker, and PWA meta tags to make ROTV installable on Android and iOS. Zero new dependencies — leverages existing brand assets and static-serving pipeline.

---

## Architecture

### PWA File Flow

```
┌─────────────────────────────────────────┐
│           frontend/public/              │
│                                         │
│   manifest.webmanifest  ─── Vite ───►  dist/manifest.webmanifest
│   sw.js                 ─── Vite ───►  dist/sw.js
│                                         │
│           Containerfile                 │
│   mv frontend/dist public  ───────►   /app/public/
│                                         │
│           Express (server.js:2652)      │
│   express.static(staticPath) ─────►   /manifest.webmanifest
│                                        /sw.js
└─────────────────────────────────────────┘
```

### Service Worker Strategy

Network-first for all GET requests. Cache only the app shell (`/`). Falls back to cached shell on navigation failure. Does not intercept non-GET requests.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Manifest | Static `.webmanifest` file | No build plugin needed; Vite copies public/ verbatim |
| Service Worker | Hand-written vanilla JS | Avoids Workbox dependency; installability requires minimal SW |
| Icons | Existing brand PNGs | 192x192 and 512x512 already in `frontend/public/brand/` |

---

## Implementation Steps

### Phase 1: New Files

- [ ] Create `frontend/public/manifest.webmanifest`
- [ ] Create `frontend/public/sw.js`

### Phase 2: Modify Existing Files

- [ ] Add PWA meta tags to `frontend/index.html`
- [ ] Add SW registration to `frontend/src/main.jsx`

### Phase 3: Verify

- [ ] `./run.sh reload-app` and verify manifest/sw.js served correctly
- [ ] Check Chrome DevTools Application tab
- [ ] `./run.sh build` passes
- [ ] User verifies install prompt on mobile

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `frontend/public/manifest.webmanifest` | Web app identity, icons, display mode |
| `frontend/public/sw.js` | Minimal service worker for installability |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/index.html` | Add manifest link, theme-color, Apple PWA meta tags |
| `frontend/src/main.jsx` | Add service worker registration |

---

## Testing Strategy

### Manual Testing

1. Visit `/manifest.webmanifest` — returns valid JSON with correct content type
2. Visit `/sw.js` — returns JavaScript
3. Chrome DevTools → Application → Manifest: shows name, icons, colors
4. Chrome DevTools → Application → Service Workers: shows `sw.js` active
5. Lighthouse audit → Installable: passes
6. Android Chrome: "Add to Home Screen" prompt appears
7. iOS Safari: Share → "Add to Home Screen" works

---

## Rollback Plan

If issues are discovered:
1. Remove `<link rel="manifest">` from index.html to disable installability
2. Remove SW registration from main.jsx
3. SW will go dormant (no fetch handler registered on next load)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Stale cached HTML after deploy | Low | Network-first strategy; cache only used on network failure |
| OG tag middleware conflict | None | OG middlewares only target og:/twitter:/title tags, not manifest/theme-color |
| iOS Safari limitations | Low | apple-mobile-web-app-capable meta tag handles iOS; no push notifications needed |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-27 | Initial plan |
