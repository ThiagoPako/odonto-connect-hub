-- ============================================================
-- Clinicorp credentials per user (SaaS multi-tenant)
-- Each authenticated user can store their own Clinicorp connection.
-- Row access is enforced at the API layer via JWT (verifyUser).
-- ============================================================

CREATE TABLE IF NOT EXISTS clinicorp_user_settings (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT FALSE,
  api_token TEXT,
  subscriber_id TEXT,
  webhook_secret TEXT,
  base_url TEXT DEFAULT 'https://api.clinicorp.com/rest/v1',
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinicorp_user_settings_enabled
  ON clinicorp_user_settings(enabled) WHERE enabled = TRUE;
