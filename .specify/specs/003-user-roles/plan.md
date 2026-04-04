# Implementation Plan: User Roles and Admin Management

> **Spec ID:** 003-user-roles
> **Status:** Planning
> **Last Updated:** 2026-04-03
> **Estimated Effort:** M

## Summary

Add a `role` column to the users table, create API endpoints for user management, build a UsersSettings component in the Settings tab, and update the auth response to include the role. Keep existing `isAdmin` middleware working by checking both `is_admin` and `role='admin'`.

---

## Implementation Steps

### Phase 1: Database Migration

- [ ] Create `backend/migrations/014_add_user_roles.sql`
- [ ] Add `role` column with CHECK constraint
- [ ] Migrate existing is_admin=true users to role='admin'

### Phase 2: Backend API

- [ ] Add `GET /api/admin/users` endpoint in `backend/routes/admin.js`
- [ ] Add `PUT /api/admin/users/:id/role` endpoint in `backend/routes/admin.js`
- [ ] Update `backend/routes/auth.js` to include `role` in `/auth/user` and `/auth/status` responses
- [ ] Update `backend/config/passport.js` to set role on user creation (match ADMIN_EMAIL -> 'admin')

### Phase 3: Frontend

- [ ] Create `frontend/src/components/UsersSettings.jsx`
- [ ] Add "Users" sub-tab to Settings in `frontend/src/App.jsx`
- [ ] Import and render UsersSettings component

### Phase 4: Schema Init Update

- [ ] Update users table CREATE in `backend/server.js` to include `role` column
- [ ] Add migration runner for `014_add_user_roles.sql`

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/migrations/014_add_user_roles.sql` | Add role column, migrate data |
| `frontend/src/components/UsersSettings.jsx` | User management UI |

### Modified Files

| File | Changes |
|------|---------|
| `backend/routes/admin.js` | Add user list and role update endpoints |
| `backend/routes/auth.js` | Include role in auth responses |
| `backend/config/passport.js` | Set role on user creation |
| `backend/server.js` | Add role column to users CREATE TABLE |
| `frontend/src/App.jsx` | Add Users sub-tab to Settings |

---

## Database Migration

```sql
-- Migration: 014_add_user_roles
-- Add role column, migrate existing admins

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'viewer';
    UPDATE users SET role = 'admin' WHERE is_admin = TRUE;
    UPDATE users SET role = 'viewer' WHERE (is_admin = FALSE OR is_admin IS NULL) AND role IS NULL;
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('viewer', 'poi_admin', 'media_admin', 'admin'));
  END IF;
END $$;
```

---

## API Implementation

### Endpoint: `GET /api/admin/users`

**Response:**
```json
[
  {
    "id": 1,
    "email": "user@example.com",
    "name": "User Name",
    "pictureUrl": "https://...",
    "oauthProvider": "google",
    "role": "admin",
    "lastLoginAt": "2026-04-03T...",
    "createdAt": "2026-03-01T..."
  }
]
```

### Endpoint: `PUT /api/admin/users/:id/role`

**Request:**
```json
{ "role": "poi_admin" }
```

**Response:**
```json
{ "id": 1, "role": "poi_admin" }
```

**Validation:**
- Cannot change own role (prevents admin lockout)
- Role must be one of: viewer, poi_admin, media_admin, admin

---

## Testing Strategy

### Manual Testing

1. Log in as admin, navigate to Settings -> Users
2. Verify all users appear with correct roles
3. Change a user's role, verify it persists after page reload
4. Verify cannot change own role
5. Verify non-admin users don't see Settings tab at all

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Admin lockout | High | Prevent self-demotion in API |
| Migration on existing data | Med | Idempotent migration with IF NOT EXISTS |
| is_admin/role divergence | Low | Keep both in sync during transition |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-04-03 | Initial plan |
