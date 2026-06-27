-- ═══════════════════════════════════════════════════════════
-- Odonto Connect — Attendance Sessions Migration
-- Persistência da fila de espera do WhatsApp/Chat
-- Run: psql -U odonto_user -d odonto_db -f migration-attendance-sessions.sql
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT NOT NULL,
  lead_name TEXT,
  lead_phone TEXT,
  attendant_id UUID REFERENCES profiles(id),
  attendant_name TEXT,
  queue_id TEXT,
  queue_name TEXT,
  started_waiting_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'closed')),
  wait_time_seconds INTEGER,
  response_time_seconds INTEGER,
  duration_seconds INTEGER,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS lead_name TEXT;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS lead_phone TEXT;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS attendant_id UUID REFERENCES profiles(id);
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS attendant_name TEXT;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS queue_id TEXT;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS queue_name TEXT;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS started_waiting_at TIMESTAMPTZ;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'waiting';
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS wait_time_seconds INTEGER;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS response_time_seconds INTEGER;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_status ON attendance_sessions(status);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_attendant ON attendance_sessions(attendant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_created ON attendance_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_tenant ON attendance_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_open ON attendance_sessions(tenant_id, status, lead_id);

-- Backfill tenant for sessions created before multi-tenant queue persistence.
UPDATE attendance_sessions s
SET tenant_id = l.tenant_id
FROM crm_leads l
WHERE s.tenant_id IS NULL
  AND l.id::text = s.lead_id
  AND l.tenant_id IS NOT NULL;