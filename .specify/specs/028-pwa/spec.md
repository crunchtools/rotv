# Specification: Progressive Web App (PWA) Support

> **Spec ID:** 028-pwa
> **Status:** In Progress
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-27

## Overview

Add Progressive Web App support so users can install Roots of The Valley on their phone (Android or iOS) directly from the browser. The installed app launches in standalone mode with its own icon, splash screen, and no browser chrome — looking and feeling like a native app while remaining the same website under the hood.

---

## User Stories

### Installation

**US-028-1: Install on Android**
> As a mobile user on Android, I want to install ROTV from my browser so that I can launch it from my home screen like a native app.

Acceptance Criteria:
- [ ] Chrome on Android shows "Add to Home Screen" or install prompt when visiting rootsofthevalley.org
- [ ] Installed app appears on home screen with ROTV icon and "ROTV" label
- [ ] App launches in standalone mode (no URL bar or browser chrome)
- [ ] App uses forest green (#2d5016) for the Android status bar

**US-028-2: Install on iOS**
> As a mobile user on iPhone, I want to add ROTV to my home screen so that I can access it like an app.

Acceptance Criteria:
- [ ] Safari on iOS shows "Add to Home Screen" option via Share menu
- [ ] Installed app appears on home screen with ROTV icon and "ROTV" label
- [ ] App launches in standalone mode (no Safari chrome)

### Manifest & Identity

**US-028-3: App Identity**
> As a user installing the app, I want to see correct branding (name, icon, colors) so that the app looks professional and trustworthy.

Acceptance Criteria:
- [ ] Web app manifest declares name "Roots of The Valley" and short_name "ROTV"
- [ ] Manifest references 192x192 and 512x512 PNG icons from existing brand assets
- [ ] Theme color (#2d5016) and background color (#f5f5f5) match the website design
- [ ] Lighthouse PWA audit "Installable" section passes

---

## Data Model

No database changes required.

---

## API Endpoints

No API changes required.

---

## UI/UX Requirements

### Meta Tags

The following meta tags are added to `index.html`:
- `<link rel="manifest">` pointing to the web app manifest
- `<meta name="theme-color">` for browser/OS UI theming
- Apple-specific meta tags for iOS home screen support

### No New Components

No React components are added. PWA support is purely infrastructure (manifest, service worker, meta tags).

---

## Non-Functional Requirements

**NFR-028-1: No New Dependencies**
- No npm packages added (no vite-plugin-pwa, no Workbox)
- Manual, lightweight implementation

**NFR-028-2: No Offline Caching of External Resources**
- Service worker does NOT cache map tiles, API responses, or CDN resources
- App remains online-dependent (map tiles require network)
- Only the app shell (index.html) is cached for installability

**NFR-028-3: No Backend Changes**
- Existing Express static-serving pipeline serves new files without modification

---

## Dependencies

- Depends on: Existing brand icons at 192x192 and 512x512 (already present)
- Depends on: HTTPS in production (already configured)
- Blocks: None

---

## Open Questions

None — all design decisions resolved during planning.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-27 | Initial draft |
