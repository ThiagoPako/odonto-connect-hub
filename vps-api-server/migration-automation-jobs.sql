-- Migration: Automation Jobs Queue
-- Stores scheduled messages from automation flows for real sending via Evolution API

CREATE TABLE IF NOT EXISTS automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id TEXT NOT NULL,
  flow_name TEXT,
  step_index INTEGER NOT NULL DEFAULT 0,
  patient_name TEXT,
  patient_phone TEXT NOT NULL,
  instance TEXT,
  variables JSONB DEFAULT '{}',
  message TEXT NOT NULL,
  channel TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'pending',  -- pending, sent, failed, cancelled
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_status_scheduled
  ON automation_jobs (status, scheduled_at) WHERE status = 'pending';
