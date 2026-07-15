# Implementation Plan: USFT Tracker Token in Admin Settings

> **Spec ID:** 040-usft-token-admin-settings
> **Status:** Planning
> **Last Updated:** 2026-07-14
> **Estimated Effort:** S

## Summary

Add `usft_sharing_token` to `admin_settings`, teach `trainTrackerService.js` to read the
token lazily from the DB with an env-var fallback, whitelist the key in the admin settings
route, and surface a masked field in the Data Collection settings UI — mirroring the
existing Serper API-key plumbing end to end.

---

## Architecture

### Data Flow

1. Admin saves token in Settings → Data Collection → API Keys (`PUT /api/admin/settings/usft_sharing_token`).
2. Value persists to `admin_settings (key='usft_sharing_token')`.
3. On each auth cycle, `trainTrackerService.authenticate()` resolves the token via
   `getSharingToken(pool)`: DB value first, `process.env.USFT_SHARING_TOKEN` fallback.
4. `run.sh seed` copies the production DB, carrying the token into local/staging automatically.

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Storage | `admin_settings` key/value row | Matches serper/gemini/buttondown keys; syncs with DB |
| Token read | Lazy DB query per auth, env fallback | Token can no longer be a module-load const; must reflect live DB + rotation |

---

## Implementation Steps

### Phase 1: Backend

- [ ] Add migration `087_usft_sharing_token.sql` seeding an empty `usft_sharing_token` row (INSERT … ON CONFLICT DO NOTHING).
- [ ] `trainTrackerService.js`: replace module-const `SHARING_TOKEN` with `getSharingToken(pool)` — `SELECT value FROM admin_settings WHERE key='usft_sharing_token'`, trimmed; fall back to `process.env.USFT_SHARING_TOKEN`.
- [ ] `authenticate()` uses the resolved token; startup guard (`if (!token) … not starting`) becomes an async check via `getSharingToken`.
- [ ] Keep the DB-read defensive: a query error resolves to the env fallback, never throws into the poll loop.

### Phase 2: API

- [ ] `admin.js`: add `'usft_sharing_token'` to the `allowedKeys` array in `PUT /settings/:key`.
- [ ] Add `usft_sharing_token` to the masked GET `/settings` response (`{ isSet }`, like `serper_api_key`).
- [ ] (Optional, for parity) `POST /settings/usft-sharing-token/test` → calls USFT `/auth/login/shared-view` with the stored token, returns valid/invalid.

### Phase 3: Frontend

- [ ] `DataCollectionSettings.jsx`: add `usftToken` / `usftTokenSet` state, a masked input, Save handler (`PUT usft_sharing_token`), and Configured/Not-configured indicator inside the existing **API Keys** section (clone the Serper block). Add a Test button only if the `/test` endpoint is included.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/087_usft_sharing_token.sql` | Seed the `usft_sharing_token` admin setting |

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/trainTrackerService.js` | DB-first token resolution with env fallback; async startup guard |
| `backend/routes/admin.js` | Whitelist key; masked GET; optional test endpoint |
| `frontend/src/components/DataCollectionSettings.jsx` | USFT token field in API Keys section |

---

## Database Migrations

```sql
-- Migration: 087_usft_sharing_token
-- Description: Move the USFT (CVSR train tracker) sharing token into admin_settings (#550)

INSERT INTO admin_settings (key, value, updated_at)
VALUES ('usft_sharing_token', '', NOW())
ON CONFLICT (key) DO NOTHING;
```

---

## Testing Strategy

### Unit Tests

- [ ] `trainTrackerService` token resolution: DB value wins; empty DB falls back to env; neither → declines to start.

### Manual Testing

1. With no env var and an empty DB setting, tracker logs "no token — not starting".
2. Save a token in Settings → Data Collection → API Keys; confirm the marker begins updating without an app restart.
3. Set only the env var (empty DB setting) → tracker still authenticates (backward compat).
4. Confirm GET settings never returns the raw token (only `isSet`).

---

## Rollback Plan

1. Revert the branch; the env-var path is untouched, so production keeps working.
2. The seeded empty `admin_settings` row is inert (`ON CONFLICT DO NOTHING`) and needs no cleanup.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| DB read for token throws inside the poll loop | Med | Wrap in try/catch, fall back to env, never rethrow — preserves spec-038 self-healing |
| Token logged in plaintext | Med | GET returns only `isSet`; never log the value |
| Production env var removed before DB set | High | Keep env fallback; only remove the env var after confirming the DB setting drives auth |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-07-14 | Initial plan |
