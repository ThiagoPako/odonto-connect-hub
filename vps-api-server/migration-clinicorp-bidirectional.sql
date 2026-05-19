-- Migração para Evoluções e Documentos do Clinicorp

-- Evoluções de Tratamento
CREATE TABLE IF NOT EXISTS clinicorp_evolutions (
  id BIGINT PRIMARY KEY,
  patient_id BIGINT,
  professional_id BIGINT,
  treatment_id BIGINT,
  description TEXT,
  date TIMESTAMPTZ,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinicorp_evolutions_patient ON clinicorp_evolutions(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinicorp_evolutions_treatment ON clinicorp_evolutions(treatment_id);

-- Documentos/Anexos
CREATE TABLE IF NOT EXISTS clinicorp_documents (
  id BIGINT PRIMARY KEY,
  patient_id BIGINT,
  title TEXT,
  file_url TEXT,
  category TEXT,
  date DATE,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinicorp_documents_patient ON clinicorp_documents(patient_id);

-- Adicionar clinicorp_id em tabelas locais se não existir (para garantir mapeamento)
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS clinicorp_appointment_id TEXT;
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS clinicorp_patient_id TEXT;
ALTER TABLE dentistas ADD COLUMN IF NOT EXISTS clinicorp_professional_id TEXT;
ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS clinicorp_financial_id TEXT;

-- Histórico de sincronização para auditoria de espelhamento (Push)
CREATE TABLE IF NOT EXISTS clinicorp_push_log (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL, -- 'appointment', 'patient', 'financial'
  local_id TEXT NOT NULL,
  clinicorp_id TEXT,
  action TEXT NOT NULL, -- 'create', 'update', 'delete'
  status TEXT NOT NULL, -- 'success', 'error'
  payload JSONB,
  response JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
