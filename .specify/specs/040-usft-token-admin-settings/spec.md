# Specification: USFT Tracker Token in Admin Settings

> **Spec ID:** 040-usft-token-admin-settings
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-07-14

## Overview

The CVSR live train tracker authenticates to the US Fleet Tracking (USFT) API with a
sharing token that today lives only in the production container's environment file
(`USFT_SHARING_TOKEN`). Because it never comes down with a `run.sh seed` DB sync, local
and staging environments can't drive the live tracker without hand-copying the secret.
This feature moves the token into the `admin_settings` table — the same place Serper,
Gemini, and Buttondown keys already live — so it syncs with the database, is rotatable
from the admin UI, and no longer requires a redeploy to change.

---

## User Stories

### Configuration

**US-040-1: Configure the token from the admin UI**
> As an admin, I want to set and rotate the USFT sharing token in Settings → Data Collection
> so that I can change it without editing an env file or redeploying the container.

Acceptance Criteria:
- [ ] Settings → Data Collection → API Keys shows a "USFT Tracker Token" field
- [ ] Saving a value persists it to `admin_settings` under key `usft_sharing_token`
- [ ] The field masks the stored value and shows a "Configured / Not configured" indicator, matching the Serper key field
- [ ] The train tracker picks up a newly-saved token without an app restart

**US-040-2: Token travels with the database**
> As a developer, I want the token to arrive with a `run.sh seed` production DB sync
> so that a local environment can drive the live tracker without copying secrets by hand.

Acceptance Criteria:
- [ ] After a production DB sync, `admin_settings` contains the current token
- [ ] The tracker authenticates using the DB value with no env var set

**US-040-4: One Save updates both the map marker and the button**
> As an admin, I want saving the token to update both the live map marker and the green
> "Live Tracker" button so that rotating the key takes effect everywhere without a restart.

Acceptance Criteria:
- [ ] The map marker and the CVSR "Live Tracker" button are both driven by the single `usft_sharing_token` (the lvgps view URL embeds the same token the USFT API authenticates with)
- [ ] Saving the token invalidates the tracker's cached JWT so the next poll re-authenticates with the new token
- [ ] Saving the token rewrites `live_tracker_url` to `https://www.lvgps.net/view/<token>` for POIs using the lvgps view, and leaves other trackers (e.g. the water-taxi `trackmyshuttle.com` URL) untouched

### Backward Compatibility

**US-040-3: Env var still works during transition**
> As an operator, I want the existing `USFT_SHARING_TOKEN` env var to keep working
> so that production keeps running before and during the migration.

Acceptance Criteria:
- [ ] When the DB setting is empty, the tracker falls back to `process.env.USFT_SHARING_TOKEN`
- [ ] When the DB setting is present, it takes precedence over the env var
- [ ] With neither configured, the tracker declines to start and logs the reason (current behavior preserved)

---

## Data Model

### Schema Changes

No table or column changes. One new row in the existing `admin_settings` key/value table:

```sql
-- Seed an empty setting so the admin UI has a row to render/edit.
INSERT INTO admin_settings (key, value, updated_at)
VALUES ('usft_sharing_token', '', NOW())
ON CONFLICT (key) DO NOTHING;
```

---

## API Endpoints

Reuses the existing generic settings endpoints — no new routes required for save/read.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| PUT | `/api/admin/settings/usft_sharing_token` | Save the token (key added to `allowedKeys`) | Admin |
| GET | `/api/admin/settings` | Returns `usft_sharing_token: { isSet }` (masked, like other secrets) | Admin |
| POST | `/api/admin/settings/usft-sharing-token/test` | Optional: validate the token against USFT auth | Admin |

---

## UI/UX Requirements

### Modified Components

- `DataCollectionSettings.jsx` — add a "USFT Tracker Token" field inside the existing
  **API Keys** section, cloning the Serper key pattern (masked input, Save button,
  Configured/Not-configured indicator, optional Test button).

---

## Non-Functional Requirements

**NFR-040-1: Secret handling**
- The token value is never returned in plaintext by the GET settings endpoint — only an `isSet` boolean, consistent with `serper_api_key`, `gemini_api_key`, and `buttondown_api_key`.

**NFR-040-2: Resilience preserved**
- The tracker's self-healing poll loop (spec 038 follow-up) must be unaffected: a DB read failure while fetching the token must not crash the poller, and lazy auth/retry behavior stays intact.

---

## Dependencies

- Depends on: `038-cvsr-train-tracker` (the tracker being configured)
- Blocks: none

---

## Open Questions

1. Include the optional `/test` endpoint + Test button now, or defer? (Serper and GitHub keys have one; leaning yes for parity.)
2. Should future tracker keys (e.g., a water-taxi key) share an "API Keys → Trackers" grouping? Out of scope here; the single key slots into the existing API Keys section.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-07-14 | Initial draft |
