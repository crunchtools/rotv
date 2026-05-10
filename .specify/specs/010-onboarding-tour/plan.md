# Implementation Plan: New User Onboarding — About Page & Interactive Tour

> **Spec ID:** 010-onboarding-tour
> **Status:** Planning
> **Last Updated:** 2026-05-10
> **Estimated Effort:** M

## Summary

Add an About tab to the main navigation and a custom guided tour overlay. Pure frontend — no backend or database changes. Three new React components, modifications to App.jsx for the tab and tour state, and CSS for the spotlight overlay effect.

---

## Architecture

### Component Diagram

```
┌──────────────────────────────────────────┐
│                App.jsx                    │
│                                          │
│   ┌──────────────────────────────────┐   │
│   │  Header Nav (tabs)               │   │
│   │  Map | Results | News | Events   │   │
│   │  [About] | Login                 │   │
│   └──────────────────────────────────┘   │
│                                          │
│   ┌──────────────────────────────────┐   │
│   │  AboutPage (when activeTab =     │   │
│   │  'about')                        │   │
│   └──────────────────────────────────┘   │
│                                          │
│   ┌──────────────────────────────────┐   │
│   │  GuidedTour (overlay, when       │   │
│   │  tourActive = true)              │   │
│   └──────────────────────────────────┘   │
│                                          │
│   ┌──────────────────────────────────┐   │
│   │  TourPrompt (first visit only)   │   │
│   └──────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

### Data Flow

1. App.jsx checks localStorage for `rotv-tour-seen` on mount
2. If not set → show TourPrompt modal
3. User clicks "Take a Tour" → set tourActive state, dismiss prompt, set localStorage flag
4. GuidedTour renders overlay with spotlight on current step's target element
5. Steps 1-4 highlight map-related elements (map, zoom, overlays, POI sidebar tabs)
6. Steps 5-8 highlight header nav tabs (Results, News, Events, Login)
7. User clicks Next/End → advance or dismiss tour
8. About tab click → render AboutPage with "Take a Tour" button (re-triggers tour)

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Tour positioning | getBoundingClientRect() | No library needed, target elements already exist |
| Spotlight effect | CSS box-shadow on overlay | Single-div approach, performant |
| State persistence | localStorage | Simple, no backend needed |
| Tour steps config | Static array in GuidedTour | Easy to modify, no DB dependency |

---

## Implementation Steps

### Phase 1: About Page

- [ ] Create `AboutPage.jsx` component with ROTV description and feature list
- [ ] Add "About" tab button to header nav in App.jsx (after Events, before Login)
- [ ] Add `activeTab === 'about'` rendering block in App.jsx
- [ ] Add route handling for `/about` path
- [ ] Add About link to both login dropdown and user dropdown
- [ ] Style the About page (CSS in App.css)

### Phase 2: Tour Prompt

- [ ] Create `TourPrompt.jsx` — modal overlay with "Take a Tour" / "Skip" buttons
- [ ] Add localStorage check in App.jsx on mount
- [ ] Wire prompt buttons to tour state and localStorage flag

### Phase 3: Guided Tour

- [ ] Create `GuidedTour.jsx` — overlay with spotlight and step pop-up
- [ ] Define tour steps array with target selectors, titles, descriptions
- [ ] Implement spotlight positioning using getBoundingClientRect()
- [ ] Add Next/End Tour navigation
- [ ] Handle window resize (reposition spotlight)
- [ ] Add keyboard navigation (Escape to end, Enter for Next)
- [ ] Add mobile-responsive positioning

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/AboutPage.jsx` | About page content and "Take a Tour" button |
| `frontend/src/components/GuidedTour.jsx` | Tour overlay with spotlight and step navigation |
| `frontend/src/components/TourPrompt.jsx` | First-visit modal offering the tour |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/App.jsx` | Add About tab, tour state, TourPrompt/GuidedTour rendering, localStorage check, /about route |
| `frontend/src/App.css` | Styles for About page, tour overlay, spotlight, tour prompt modal |

---

## Database Migrations

None required.

---

## Testing Strategy

### Manual Testing

1. Open app in incognito → verify tour prompt appears
2. Click "Take a Tour" → verify all 8 steps highlight correct elements
3. Click "End Tour" mid-way → verify tour dismisses
4. Refresh → verify tour prompt does NOT reappear
5. Navigate to About tab → verify content renders
6. Click "Take a Tour" from About page → verify tour re-launches
7. Test on mobile viewport (375px wide) → verify responsive layout
8. Test keyboard navigation (Tab, Enter, Escape)

---

## Rollback Plan

If issues are discovered:
1. Revert the commits (pure frontend, no DB changes)
2. No data migration needed

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tour positioning broken on mobile | Med | Test multiple viewport sizes, use viewport-aware positioning |
| Tour steps break if tab structure changes | Low | Steps reference stable class names/selectors |
| Performance impact of overlay | Low | Use CSS-only spotlight (no canvas), lazy-load tour components |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-10 | Initial plan |
