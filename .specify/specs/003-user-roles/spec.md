# Specification: User Roles and Admin Management

> **Spec ID:** 003-user-roles
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-04-03

## Overview

Add a `role` column to the users table replacing the boolean `is_admin` flag, and build a Settings -> Users sub-tab where Full Admins can view all users and assign roles. This is the foundation for role-based access control, enabling future differentiation between POI Admins, Media Admins, and Viewers. The existing `isAdmin` middleware continues to work during the transition.

---

## User Stories

### User Management

**US-001: View All Users**
> As a Full Admin, I want to see a list of all registered users so that I can understand who has access to the system.

Acceptance Criteria:
- [ ] Users tab shows name, email, profile picture, OAuth provider, role, and last login
- [ ] List is sorted by last login (most recent first)
- [ ] Current user is visually indicated

**US-002: Assign User Roles**
> As a Full Admin, I want to assign roles to users so that I can grant appropriate access levels.

Acceptance Criteria:
- [ ] Role dropdown with options: viewer, poi_admin, media_admin, admin
- [ ] Role changes take effect immediately (no page reload required)
- [ ] Cannot demote yourself from admin (prevents lockout)
- [ ] Success/error feedback on role change

**US-003: Role Migration**
> As an existing admin (is_admin=true), I want my account automatically migrated to the admin role so that I don't lose access.

Acceptance Criteria:
- [ ] Migration sets role='admin' where is_admin=true
- [ ] Migration sets role='viewer' for all other users
- [ ] is_admin column preserved during transition (not dropped)

---

## Data Model

### Schema Changes

```sql
-- Migration 014: Add role column to users table
ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'viewer';

-- Migrate existing admins
UPDATE users SET role = 'admin' WHERE is_admin = TRUE;
UPDATE users SET role = 'viewer' WHERE is_admin = FALSE OR is_admin IS NULL;

-- Add CHECK constraint
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('viewer', 'poi_admin', 'media_admin', 'admin'));
```

### Role Definitions

| Role | Description |
|------|-------------|
| `viewer` | Default role. Read-only access. |
| `poi_admin` | Can create/edit/delete POIs. |
| `media_admin` | Can upload/manage images. |
| `admin` | Full access including settings and user management. |

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/admin/users` | List all users with roles | Admin |
| PUT | `/api/admin/users/:id/role` | Update a user's role | Admin |

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| GET | `/auth/user` | Add `role` field to response |
| GET | `/auth/status` | Add `role` field to response |

---

## UI/UX Requirements

### New Components

- `UsersSettings.jsx` - Users management tab within Settings, showing user list with role assignment

### Settings Tab Integration

Add "Users" button to the second row of settings sub-tabs (alongside Moderation, Jobs, Data Collection, Google).

---

## Dependencies

- Depends on: None (standalone feature)
- Blocks: Future role-based middleware refactoring (full #98 implementation)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-04-03 | Initial draft |
