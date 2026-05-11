# Specification: Improved About Page

> **Spec ID:** 011-improved-about-page
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-11

## Overview

Transform the About tab from a single static page into a sub-tabbed experience matching the pattern used by Results/Events/Settings. Consolidates Story, Tutorial, Feedback, and Privacy into one place, removes Settings from the main tab bar, and moves it under the Login button.

---

## User Stories

### Navigation

**US-001: Sub-tab Navigation**
> As a user, I want the About page to have sub-tabs so that I can find Story, Tutorial, Feedback, and Privacy content without hunting through menus.

Acceptance Criteria:
- [ ] About tab renders sub-tabs: Story | Tutorial | Send Feedback | Privacy Policy
- [ ] Sub-tabs use roving tabindex for keyboard navigation (Tab moves focus to active sub-tab, arrow keys move between sub-tabs)
- [ ] Active sub-tab is visually indicated and persists during the session
- [ ] Default sub-tab on first visit is Story

**US-002: Settings Relocation**
> As a user, I want Settings accessible from the Login/Account menu so that the main tab bar stays focused on content discovery.

Acceptance Criteria:
- [ ] Settings is removed from the main tab row
- [ ] Settings link appears in the Login/Account dropdown (for authenticated users)
- [ ] Settings page still functions identically (General, Newsletter, Admin sub-tabs)

**US-003: RSS Feed in Settings**
> As a user, I want to find the RSS feed link in Settings alongside Newsletter so that subscription options are grouped together.

Acceptance Criteria:
- [ ] New "RSS Feed" sub-tab appears to the right of Newsletter in Settings
- [ ] RSS sub-tab shows the Buttondown RSS link with a brief description
- [ ] RSS link removed from Login/Account dropdown

### Content

**US-004: Story Sub-tab**
> As a visitor, I want to read about what ROTV is and why it exists so that I understand the project's purpose and community roots.

Acceptance Criteria:
- [ ] Story content focuses on: the problem (fragmented info), the solution (living map), and the open source community ethos
- [ ] Content is concise (fits in one scroll on desktop)
- [ ] No FAQ — just the narrative

**US-005: Tutorial Sub-tab**
> As a new user, I want to launch the guided tour from the About page so that I can learn how to use the map.

Acceptance Criteria:
- [ ] Tutorial sub-tab shows brief intro text and a "Take a Tour" button
- [ ] Clicking the button starts the existing GuidedTour

**US-006: Send Feedback Sub-tab**
> As a user, I want to send feedback directly from the About page so that I don't need to find it in a dropdown menu.

Acceptance Criteria:
- [ ] Renders the existing FeedbackForm component inline
- [ ] Feedback link removed from Login/Account dropdown (About tab is the canonical location)

**US-007: Privacy Policy Sub-tab**
> As a user, I want to read the privacy policy within the About page so that legal information is easy to find.

Acceptance Criteria:
- [ ] Renders the existing PrivacyPolicy component inline
- [ ] Privacy Policy link removed from Login/Account dropdown

---

## UI/UX Requirements

### Sub-tab Layout

```
[Story] [Tutorial] [Send Feedback] [Privacy Policy]
─────────────────────────────────────────────────────
| Content area (scrollable)                          |
|                                                    |
└────────────────────────────────────────────────────┘
```

- Sub-tabs should match the visual pattern of Settings sub-tabs (horizontal row, active underline, same font/spacing)
- Content area scrolls independently within the card
- On mobile, sub-tab labels can abbreviate if needed (e.g., "Story", "Tour", "Feedback", "Privacy")

### Main Tab Bar Change

Before: `Results | News | Events | About | Settings`
After: `Results | News | Events | About`

### Login/Account Dropdown Change

Before: `RSS Feed | Privacy Policy | Send Feedback`
After: `Settings | Send Feedback` (Send Feedback stays as a quick shortcut)

Wait — per the issue, Send Feedback moves INTO About. Let me revise:

After (logged in): `Settings`
After (not logged in): _(just login buttons)_

Actually, re-reading the issue: "Move Settings tab to an entry under the Login button." So:

After (logged in dropdown): `[user info] | Settings | Logout`
After (login dropdown): `[Google] [Facebook]`

---

## Non-Functional Requirements

**NFR-001: Accessibility**
- Roving tabindex on About sub-tabs (matches existing implementation in Settings)
- All sub-tab panels are `role="tabpanel"` with proper `aria-labelledby`

**NFR-002: URL Routing**
- `/about` defaults to Story sub-tab
- `/about/story`, `/about/tutorial`, `/about/feedback`, `/about/privacy` are deep-linkable

---

## Dependencies

- Depends on: #215 (roving tabindex implementation — already merged)
- Depends on: #212 (guided tour — already merged)
- Depends on: #217 (feedback form — already merged)

---

## Resolved Questions

1. **Send Feedback** — fully moves into About page. No shortcut in dropdown.
2. **Story content** — approved. See `story-draft.md` in this spec directory.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-11 | Initial draft |
