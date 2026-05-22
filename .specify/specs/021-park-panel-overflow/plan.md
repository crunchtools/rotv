# Implementation Plan: Scrollable Legend Sections (Park/Municipal Panel Overflow Fix)

> **Spec ID:** 021-park-panel-overflow
> **Status:** Planning
> **Last Updated:** 2026-05-22
> **Estimated Effort:** S

## Summary

Make the open accordion section's body scroll within the fixed-height legend panel by
turning `.legend-content` into a flex column, pinning the search box and section
headers, and letting the open section grow and scroll. One small JSX change tags the
open section; the rest is CSS.

---

## Architecture

### Current layout (desktop, docked)

```
.legend            height: min(480px, 70vh); display:flex; flex-direction:column
└─ .legend-content flex:1; min-height:0; overflow:hidden   ← clips overflow, no scroll
   ├─ .legend-search
   ├─ .legend-section (poi)        accordion; one open at a time
   ├─ .legend-section (parks)      └─ .legend-section-body (hidden when closed)
   └─ .legend-section (municipal)
```

Root cause: `.legend-content { overflow: hidden }` (App.css ~2626) clips the open
section's `.boundary-chips` once they exceed the panel height; nothing scrolls.

### Target layout

```
.legend-content    flex column (unchanged: flex:1; min-height:0; overflow:hidden)
   ├─ .legend-search          flex: 0 0 auto   (pinned)
   ├─ .legend-section         flex column; closed = content height (pinned header)
   └─ .legend-section.open    flex: 1 1 auto; min-height:0
        └─ .legend-section-body  flex:1 1 auto; min-height:0; overflow-y:auto  ← scrolls
```

Because the sections are already an accordion (single `openSection` state), only one
body ever needs to scroll, and it gets all remaining panel height.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Layout | CSS flexbox (existing) | `.legend` is already a flex column; extend it rather than add JS measurement |
| Open-section marker | React class toggle | Minimal: add `open` class in `LegendSection` from existing `isOpen` prop |

---

## Implementation Steps

### Phase 1: Mark the open section

- [ ] In `frontend/src/components/Map.jsx`, `LegendSection`: change the wrapper to
      `className={`legend-section ${isOpen ? 'open' : ''}`}`.

### Phase 2: CSS scroll behavior (desktop docked)

- [ ] `.legend-content`: add `display: flex; flex-direction: column;` (keep `flex:1; min-height:0; overflow:hidden`).
- [ ] `.legend-search`: `flex: 0 0 auto;` so it stays pinned.
- [ ] `.legend-section`: `display: flex; flex-direction: column;`.
- [ ] `.legend-section.open`: `flex: 1 1 auto; min-height: 0;`.
- [ ] `.legend-section.open .legend-section-body`: `flex: 1 1 auto; min-height: 0; overflow-y: auto;`.
- [ ] Hide the scrollbar (per user request — overlay/transparent scrolling) using the
      existing pattern from `.poi-news-list-content` (App.css ~1561): `scrollbar-width: none;`
      (Firefox), `-ms-overflow-style: none;` (IE/Edge), and `::-webkit-scrollbar { display: none; }`
      (Chrome/Safari). Scrolling via wheel/trackpad/touch/drag still works.

### Phase 3: Verify no mobile/expanded regression

- [ ] Confirm `@media (max-width: 768px)` still makes `.legend` scroll as a whole
      (`.legend-content { display: block }` neutralizes the flex sizing; the open body
      has no height constraint so the panel scrolls — existing behavior).
- [ ] Confirm `.legend.legend-expanded` (desktop popup, `height:auto; max-height:80vh; overflow-y:auto`)
      still scrolls the whole popup.

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/Map.jsx` | Add `open` class to `LegendSection` wrapper (1 line) |
| `frontend/src/App.css` | Flex/scroll rules on `.legend-content`, `.legend-search`, `.legend-section`, `.legend-section.open`, `.legend-section.open .legend-section-body` |

### New Files

None.

---

## Database Migrations

None.

---

## Testing Strategy

### Manual Testing (primary)

1. Desktop: open the **Parks** section — confirm a scrollbar appears and all ~36 chips
   are reachable; the panel does not run off the map.
2. Desktop: open **Municipal** — same behavior; search box and headers stay visible.
3. Switch between sections — accordion still closes the others; open section gets the height.
4. Open a short section (e.g. POI with few items) — no scrollbar, no awkward empty space.
5. Mobile (≤768px, devtools): whole panel still scrolls; no clipping.
6. Desktop expanded popup: still scrolls as before.

### Automated

- No existing Playwright/unit tests target the legend list. Tests run post-merge via
  `/deploy` (`./run.sh test`); a smoke check that the map + legend render is sufficient.

---

## Rollback Plan

If issues appear:
1. Revert the App.css rules and the one-line `Map.jsx` class change.
2. The panel returns to the prior (clipping) behavior; no data or API impact.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Flex sizing differs across browsers | Low | Standard `flex:1 1 auto; min-height:0; overflow-y:auto` pattern; verify in Chrome (issue browser) |
| Mobile regression | Low | Mobile rules are `!important` and override desktop flex; verify in devtools |
| Short sections look odd when grown | Low | Only the open section grows; closed headers stay compact — verified manually |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-22 | Initial plan |
