# Specification: Privacy Statement

> **Spec ID:** 008-privacy-statement
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-09

## Overview

Add a privacy statement page accessible from the login flow, sidebar settings, and a persistent link in the UI. ROTV collects minimal data via Google/Facebook OAuth and doesn't monetize user data. The privacy statement should reflect this honest, transparent posture.

---

## User Stories

### Visitor Trust

**US-001: View Privacy Statement Before Sign-Up**
> As a visitor considering signing in, I want to read a privacy statement so that I understand what data ROTV collects before I authenticate.

Acceptance Criteria:
- [ ] Privacy statement link is visible in the login dropdown
- [ ] Link opens the privacy page without requiring authentication
- [ ] Page clearly states what data is collected and how it's used

**US-002: Access Privacy Statement from Settings**
> As an authenticated user, I want to find the privacy statement in settings so that I can review it at any time.

Acceptance Criteria:
- [ ] Privacy link appears in the user settings area
- [ ] Link navigates to the privacy page

**US-003: Access Privacy Statement from Sidebar**
> As any user (authenticated or not), I want a persistent privacy link so I can always find the statement.

Acceptance Criteria:
- [ ] Privacy link is accessible from the sidebar bottom area
- [ ] Works for both authenticated and unauthenticated users

---

## Privacy Statement Content

The statement must cover:
1. **Data collected** — Google/Facebook profile info (name, email, avatar), usage preferences stored locally
2. **How data is stored** — PostgreSQL on infrastructure we control, no third-party analytics
3. **Data sharing** — None. ROTV is a non-profit community project. No ads, no data sales, no third-party sharing.
4. **User rights** — Account deletion available, data export on request
5. **Cookies** — Session cookies for authentication only, no tracking cookies
6. **Open source** — Link to GitHub repo so users can verify claims

---

## UI/UX Requirements

### New Route

- `/privacy` — renders the privacy statement as a full-page content view (overlays or replaces the map view)

### Link Locations

1. **Login dropdown** — small "Privacy Policy" link below the OAuth buttons
2. **User settings** — link in the settings panel
3. **Sidebar bottom** — subtle link always visible

---

## Non-Functional Requirements

**NFR-001: Accessibility**
- Privacy page must be readable without JavaScript (server-side rendered or static)
- Actually — this is a React SPA. The page renders client-side like everything else. Fine.

**NFR-002: No External Dependencies**
- Content is hardcoded in the component, not fetched from a CMS or database

---

## Open Questions

1. Should we add a "last updated" date to the privacy page? (Probably yes)
2. Does the Google OAuth consent screen need a URL update to point to `/privacy`? (Check Google Cloud Console)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-09 | Initial draft |
