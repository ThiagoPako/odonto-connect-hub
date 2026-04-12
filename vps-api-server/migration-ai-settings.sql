-- AI Settings & Clinical Reports
-- Run: psql -U odonto_user -d odonto_db -f migration-ai-settings.sql

CREATE TABLE IF NOT EXISTS ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL UNIQUE, -- 'openai', 'manus'
  api_key TEXT NOT NULL,
  model TEXT DEFAULT 'gpt-4o-mini',
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clinical_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id TEXT NOT NULL,
  patient_name TEXT,
  attendant_id TEXT,
  attendant_name TEXT,
  transcription TEXT,
  report TEXT,
  queixa_principal TEXT,
  procedimento TEXT,
  dente_regiao TEXT,
  prescricoes JSONB DEFAULT '[]',
  duration_seconds INTEGER,
  audio_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_reports_patient ON clinical_reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_reports_created ON clinical_reports(created_at DESC);
