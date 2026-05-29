-- 069_mcp_user_tokens.sql
-- Per-user MCP authentication tokens. Each user gets a unique token
-- for MCP server access. Admins get full tools, regular users get read-only.

ALTER TABLE users ADD COLUMN IF NOT EXISTS mcp_token VARCHAR(64) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_mcp_token ON users(mcp_token) WHERE mcp_token IS NOT NULL;
