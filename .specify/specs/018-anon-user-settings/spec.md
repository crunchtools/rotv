# Specification: Anonymous User Settings & Tour Accessibility

> **Spec ID:** 018-anon-user-settings
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-19

## Overview

Anonymous (non-logged-in) visitors hit dead-ends in both guided tutorials and in the settings UI. The main tour's Newsletter step and the Trip Planner tour's "My Trips"/"Save" steps point at controls that only render when authenticated, so the tour spotlights a missing DOM target. The `/settings` route itself is gated and redirects anon users back to the map.

This spec makes user-level customizations — timezone, newsletter subscription, saved trips — usable without an account by backing them with `localStorage`. When a visitor eventually creates an account, any locally-held state is pushed to the backend so it follows them across devices. Tour steps for both tutorials become navigable from a fresh incognito session.

Out of scope: admin-only settings (Themes, Activities, Icons, Moderation, etc.) remain gated.

Closes #379.

---

## User Stories

### Anonymous Tour Completion

**US-018-01: First-time visitor finishes the main tutorial**
> As a first-time, not-logged-in visitor, I want to step through the welcome tour from end to end so that I understand the app without needing to sign up first.

Acceptance Criteria:
- [ ] Step 3 (Browse Results) draws the spotlight once with no flicker
- [ ] Step 11 (Newsletter) lands on a visible newsletter signup form and highlights the subscribe button
- [ ] Tour does not abandon, fail, or spotlight an empty region on any step

**US-018-02: First-time visitor finishes the Trip Planner tour**
> As a first-time, not-logged-in visitor, I want to step through the Trip Planner tutorial so that I learn how trip building works before deciding whether to create an account.

Acceptance Criteria:
- [ ] All five trip-tour steps render correctly without authentication
- [ ] Step 4 (Navigate · Save · My Trips) and Step 5 (My Trips Anywhere) point at controls that exist for anonymous users
- [ ] Where saving requires signup (depending on Open Question OQ-1), the tour clearly says so

### Anonymous Customization

**US-018-03: Anon visitor sets their timezone**
> As a not-logged-in visitor, I want to set my timezone so that news and event dates display correctly to me.

Acceptance Criteria:
- [ ] `/settings` is accessible without authentication
- [ ] General tab renders for anon visitors; timezone selector saves to `localStorage` (already today's behavior — confirm)
- [ ] Profile section (read-only email from auth provider) is hidden for anon users

**US-018-04: Anon visitor subscribes to the newsletter**
> As a not-logged-in visitor, I want to subscribe to the newsletter from the in-app settings so that I don't have to sign up to receive the weekly digest.

Acceptance Criteria:
- [ ] Newsletter tab in `/settings` renders for anon visitors
- [ ] Email field persists to `localStorage` so a reload before submitting doesn't lose input
- [ ] `POST /api/newsletter/subscribe` accepts the request anonymously (no backend change — endpoint already allows it)
- [ ] On success, the success message displays the same as for logged-in users

**US-018-05: Anon visitor builds and saves a trip locally**
> As a not-logged-in visitor, I want to build a day-trip and save it locally so that I can come back to it later, even before creating an account.

Acceptance Criteria:
- [ ] Add-to-Trip works for anon visitors (current behavior — confirm)
- [ ] Save action persists the trip to `localStorage` for anon visitors *(Pending OQ-1 decision)*
- [ ] My Trips menu item is visible (or has an anon equivalent) when there is at least one locally-saved trip *(Pending OQ-1)*

### Sync on Sign-up

**US-018-06: Locally-held state follows me when I create an account**
> As a returning anon visitor who decides to sign up, I want my timezone, newsletter subscription, and saved trips to follow me onto my new account so that I don't have to re-enter them.

Acceptance Criteria:
- [ ] On first successful login or account creation, the client POSTs any local settings/trips to backend sync endpoints
- [ ] Backend stores the synced state under the new user
- [ ] After successful sync, `localStorage` keys for synced fields are cleared (or marked synced)
- [ ] Sync is idempotent — replaying it does not duplicate trips or re-subscribe

---

## Data Model

### Schema Changes

```sql
-- Per-user timezone preference (currently only client-side)
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;

-- Per-user saved trips: depends on OQ-2
-- (If new table needed, add 018_create_saved_trips.sql)
```

### LocalStorage Keys (canonical)

| Key | Type | Lifetime | Notes |
|-----|------|----------|-------|
| `rotv-tour-seen` | bool flag | permanent | already used |
| `app-timezone` | string | until cleared on sync | already used |
| `rotv-newsletter-email` | string | until cleared on sync | new — preserves input across reloads |
| `rotv-newsletter-subscribed` | bool | permanent for anon | new — suppresses re-prompts |
| `rotv-saved-trips` | JSON array | until cleared on sync | new, pending OQ-1 |

---

## API Endpoints

### New / Changed Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/user/settings/sync` | Bulk-upsert anon settings on first login | Authenticated |
| POST | `/api/newsletter/subscribe` | (existing) accepts anonymous emails | None |
| POST | `/api/trips` | (existing) create saved trip — anon variant TBD | Auth or anon (OQ-1) |

`/api/user/settings/sync` request body:
```json
{
  "timezone": "America/New_York",
  "newsletter": { "email": "user@example.com", "subscribed": true },
  "trips": [ { "name": "...", "stops": [...] } ]
}
```

---

## UI/UX Requirements

### Changes to existing components

- `App.jsx` — Remove the `useEffect` that bounces anon users off `/settings` (lines ~402–406). Settings tab visible in nav for anon users too.
- `App.jsx` settings panel — keep current `isAdmin ? <admin nav> : <UserSettings>` branch. `UserSettings` is rendered for both authed regular users and anon users; it conditionally hides the Profile/Email section when there is no `user`.
- `UserSettings.jsx` — hide General-tab Profile section when no user; everything else (timezone, newsletter) works as today.
- `GuidedTour.jsx` — already fixed: stabilized `useEffect` so step 3 no longer flickers on re-render. The Newsletter step (main tour) and the Trip Save/My Trips steps (trip tour) become reachable thanks to the settings ungating; no step-array changes required if OQ-1 resolves toward localStorage trips.
- New helper `frontend/src/utils/anonSettings.js` — small read/write/sync helpers around the localStorage keys above.
- Auth post-login hook — when `useAuth()` transitions from anon → authed, invoke the sync helper to flush `localStorage` to `/api/user/settings/sync`.

### Wireframes

Settings page for anon user (desktop):
```
+----------------------------------------------------+
| [Settings]                                         |
|                                                    |
|  General | Newsletter                              |
|  --------                                          |
|                                                    |
|  🕐 Timezone                                       |
|  [select: America/New_York v]                      |
|  [Save]                                            |
|                                                    |
+----------------------------------------------------+
```

(Profile section is hidden — the Newsletter tab renders the same `<NewsletterSignup>` form used by the existing UserSettings newsletter tab.)

---

## Non-Functional Requirements

**NFR-018-01: Privacy**
- LocalStorage data stays on-device until the user explicitly creates an account.
- Sync endpoint is authenticated; anon visitors cannot push state on someone else's behalf.

**NFR-018-02: Backward compatibility**
- Existing logged-in users see no UI changes (their settings tab renders unchanged).
- Existing `app-timezone` localStorage key keeps the same name and semantics.

**NFR-018-03: Idempotency**
- Sync is safe to retry. Newsletter resubscribe is already idempotent server-side. Trip sync uses dedup by name + stops hash *(detail in plan)*.

---

## Dependencies

- Depends on: nothing (uses existing newsletter, trip APIs as starting point)
- Blocks: future personalization features that require auth-aware preferences

---

## Resolved Questions

1. **OQ-1 (Trip Planner anon flow):** Full localStorage-backed Save + My Trips, with sync on signup.
2. **OQ-2 (Saved-trips backend shape):** Existing `trips`/`trip_stops` schema is reused as-is; no new table needed. See plan §API.
3. **OQ-3 (Sync trigger):** First successful auth callback (`?auth=success` in `AuthContext.jsx`).
4. **OQ-4 (Conflict resolution):** Server-wins fill-gaps — never overwrite non-null server values; local entries only fill gaps.
5. **OQ-5 (Step 11 copy):** Keep existing wording.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-19 | Initial draft. Closes #379. |
