-- Consultations table — stores finalized consultation records linked to patients
CREATE TABLE IF NOT EXISTS consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id TEXT NOT NULL,
  patient_name TEXT,
  appointment_id TEXT,
  dentist_id TEXT,
  dentist_name TEXT,
  queixa_principal TEXT,
  procedimento TEXT,
  dente_regiao TEXT,
  observacoes TEXT,
  prescricoes JSONB DEFAULT '[]',
  duration_seconds INTEGER DEFAULT 0,
  gravacoes_count INTEGER DEFAULT 0,
  clinical_report_id UUID REFERENCES clinical_reports(id),
  status TEXT DEFAULT 'finalizado',
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_dentist ON consultations(dentist_id);
CREATE INDEX IF NOT EXISTS idx_consultations_finished ON consultations(finished_at DESC);
