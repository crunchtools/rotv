# Specification: New User Onboarding — About Page & Interactive Tour

> **Spec ID:** 010-onboarding-tour
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-10

## Overview

First-time visitors to ROTV don't discover the interactive features (login, settings, trail status, news/events filtering). This spec adds two complementary onboarding mechanisms: a persistent "About" tab in the main navigation that explains what ROTV offers, and an optional guided tour that walks new users through each major section with numbered pop-ups.

Source: Robbie Schneider feedback (April 11, 2026 email thread) — GitHub Issue #212.

---

## User Stories

### Discovery

**US-010-1: About Page**
> As a new visitor, I want to read what ROTV is and what features are available so that I can understand the app before exploring.

Acceptance Criteria:
- [ ] "About" tab appears in main navigation (between Events and Settings/Login)
- [ ] About page describes ROTV's purpose, key features, and how to get started
- [ ] About page includes a "Take a Tour" button that launches the guided tour
- [ ] About page is accessible without login

**US-010-2: First-Visit Tour Prompt**
> As a first-time visitor, I want to be offered a guided tour so that I can quickly learn what ROTV offers.

Acceptance Criteria:
- [ ] First-time visitors (no localStorage flag) see a tour prompt overlay
- [ ] Prompt offers "Take a Tour" and "Skip" options
- [ ] Dismissing the prompt sets a localStorage flag so it doesn't reappear
- [ ] Tour can be re-triggered from the About page

**US-010-3: Interactive Guided Tour**
> As a visitor taking the tour, I want numbered pop-ups highlighting each major feature so that I understand how to use the app.

Acceptance Criteria:
- [ ] Tour highlights these areas in order: (1) Map interaction, (2) Zoom controls, (3) Results tab, (4) News tab, (5) Events tab, (6) POI & Boundary Overlays, (7) POI sidebar tabs (Info/News/Events/History/Associations), (8) Login/Settings, (9) Newsletter signup under Settings → General
- [ ] Each step shows a numbered indicator, title, and brief description
- [ ] "Next" button advances to the next step
- [ ] "End Tour" button exits at any point
- [ ] Tour automatically ends after the last step
- [ ] Highlighted area is visually emphasized (spotlight/overlay effect)

---

## Data Model

No database changes required. Tour state is stored in the browser via localStorage.

---

## API Endpoints

No new API endpoints required. This is a purely frontend feature.

---

## UI/UX Requirements

### New Components

- `AboutPage` — Full-page content describing ROTV, with "Take a Tour" CTA
- `GuidedTour` — Overlay component with step-by-step pop-ups and spotlight effect
- `TourPrompt` — Modal shown to first-time visitors offering the tour

### Tour Steps

| Step | Target | Title | Description |
|------|--------|-------|-------------|
| 1 | Map area | Interactive Map | Pan, zoom, and click any point of interest to explore Cuyahoga Valley's history |
| 2 | Zoom controls | Zoom In & Out | Use these controls to zoom the map and discover more detail |
| 3 | Results tab | Browse Results | Results update as you zoom — see all points of interest in the current map view |
| 4 | News tab | Park News | News updates with the map too — AI-curated from local sources about the valley |
| 5 | Events tab | Upcoming Events | Events also follow the map — concerts, hikes, programs in your current view |
| 6 | Map legend/overlays | POIs & Boundaries | Toggle point of interest types and boundary overlays to customize your view |
| 7 | POI sidebar tabs | Explore a Place | When you click a POI, browse its Info, News, Events, History, and Associations |
| 8 | Login button | Sign In | Log in to access settings, edit mode, and personalization |
| 9 | Settings → General (newsletter) | Newsletter | Sign up for a weekly digest of news and events delivered to your inbox |

### Design Constraints

- Tour overlay must work on both desktop and mobile
- Pop-ups should not obscure the element they're highlighting
- Use existing ROTV color scheme and typography
- No external tour library dependencies — keep it lightweight and custom

---

## Non-Functional Requirements

**NFR-010-1: Performance**
- Tour components should lazy-load (not in initial bundle for returning visitors)
- localStorage check should happen synchronously to avoid flash

**NFR-010-2: Accessibility**
- Tour pop-ups must be keyboard-navigable (Tab, Enter, Escape to dismiss)
- ARIA labels on tour elements

---

## Dependencies

- None (purely frontend, no backend changes)

---

## Open Questions

1. Should the About tab replace a tab position or be added as a new tab? (Recommend: add between Events and Login)
2. Should the tour include the sidebar POI detail view? (Recommend: no, keep it to top-level navigation for v1)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-10 | Initial draft |
