-- Migration 014: Add role column to users table
-- Supports: viewer, poi_admin, media_admin, admin
-- Migrates existing is_admin data to role column

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'viewer';
    UPDATE users SET role = 'admin' WHERE is_admin = TRUE;
    UPDATE users SET role = 'viewer' WHERE is_admin = FALSE OR is_admin IS NULL;
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('viewer', 'poi_admin', 'media_admin', 'admin'));
  END IF;
END $$;
