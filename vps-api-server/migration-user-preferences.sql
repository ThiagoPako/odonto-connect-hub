-- User Preferences — notification settings synced across devices
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  sound_type VARCHAR(20) NOT NULL DEFAULT 'ding',
  sound_volume INTEGER NOT NULL DEFAULT 70,
  recovery_sound_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
