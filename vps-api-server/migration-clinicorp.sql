-- ============================================================
-- Clinicorp integration (REST API + Webhook)
-- ============================================================

-- Settings (single row per assinante; usamos id=1 como global)
CREATE TABLE IF NOT EXISTS clinicorp_settings (
  id SERIAL PRIMARY KEY,
  enabled BOOLEAN DEFAULT FALSE,
  api_token TEXT,                 -- token Bearer da Clinicorp (Authorize Swagger)
  subscriber_id TEXT,             -- id do assinante na Clinicorp
  webhook_secret TEXT,            -- valor do query ?user_api=
  base_url TEXT DEFAULT 'https://api.clinicorp.com/rest/v1',
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO clinicorp_settings (id, enabled)
  VALUES (1, FALSE)
  ON CONFLICT (id) DO NOTHING;

-- Clínicas
CREATE TABLE IF NOT EXISTS clinicorp_clinics (
  id BIGINT PRIMARY KEY,                 -- Clinicorp BusinessId
  company_id BIGINT,
  business_name TEXT,
  name TEXT,
  email TEXT,
  address TEXT,
  active TEXT,
  landline BIGINT,
  other_landline BIGINT,
  slot_time INT,
  no_limit_apt_same_time TEXT,
  subscriber_business_uid TEXT,
  working_days_hours JSONB,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profissionais (Dentistas) - derivado de appointments/users
CREATE TABLE IF NOT EXISTS clinicorp_professionals (
  id BIGINT PRIMARY KEY,                 -- Dentist_PersonId
  full_name TEXT,
  user_name TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cadeiras
CREATE TABLE IF NOT EXISTS clinicorp_chairs (
  id BIGINT PRIMARY KEY,
  business_id BIGINT,
  name TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categorias de agendamento
CREATE TABLE IF NOT EXISTS clinicorp_appointment_categories (
  id BIGINT PRIMARY KEY,
  description TEXT,
  color TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Especialidades / procedimentos
CREATE TABLE IF NOT EXISTS clinicorp_specialties (
  id BIGINT PRIMARY KEY,
  description TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pacientes
CREATE TABLE IF NOT EXISTS clinicorp_patients (
  id BIGINT PRIMARY KEY,                 -- Patient_PersonId
  name TEXT,
  email TEXT,
  mobile_phone TEXT,
  birth_date DATE,
  sex TEXT,
  document_id TEXT,
  notes TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinicorp_patients_phone ON clinicorp_patients(mobile_phone);
CREATE INDEX IF NOT EXISTS idx_clinicorp_patients_doc ON clinicorp_patients(document_id);

-- Agendamentos
CREATE TABLE IF NOT EXISTS clinicorp_appointments (
  id BIGINT PRIMARY KEY,
  business_id BIGINT,
  patient_id BIGINT,
  patient_name TEXT,
  professional_id BIGINT,
  professional_name TEXT,
  category_id BIGINT,
  category_description TEXT,
  category_color TEXT,
  chair_id BIGINT,
  status TEXT,
  date DATE,
  from_time TEXT,
  to_time TEXT,
  notes TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinicorp_appts_date ON clinicorp_appointments(date);
CREATE INDEX IF NOT EXISTS idx_clinicorp_appts_prof ON clinicorp_appointments(professional_id);
CREATE INDEX IF NOT EXISTS idx_clinicorp_appts_patient ON clinicorp_appointments(patient_id);

-- Orçamentos
CREATE TABLE IF NOT EXISTS clinicorp_estimates (
  id BIGINT PRIMARY KEY,
  treatment_id BIGINT,
  patient_id BIGINT,
  patient_name TEXT,
  professional_id BIGINT,
  professional_name TEXT,
  business_id BIGINT,
  amount NUMERIC,
  status TEXT,
  date DATE,
  create_date DATE,
  procedure_list JSONB,
  raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinicorp_est_patient ON clinicorp_estimates(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinicorp_est_date ON clinicorp_estimates(date);

-- Financeiro: pagamentos / fluxo de caixa / invoices
CREATE TABLE IF NOT EXISTS clinicorp_financial_entries (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                  -- 'invoice' | 'payment' | 'cashflow'
  external_id TEXT,
  business_id BIGINT,
  patient_id BIGINT,
  amount NUMERIC,
  date DATE,
  description TEXT,
  raw JSONB NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_clinicorp_fin_date ON clinicorp_financial_entries(date);

-- Financeiro: resumos mensais retornados pela Clinicorp em endpoints agregados
CREATE TABLE IF NOT EXISTS clinicorp_monthly_summary (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                  -- 'payment' | 'cashflow'
  period_month DATE NOT NULL,
  business_id BIGINT NOT NULL DEFAULT 0,
  total_in NUMERIC,
  total_out NUMERIC,
  total_amount NUMERIC,
  cash NUMERIC,
  credit_card NUMERIC,
  debit_card NUMERIC,
  pix NUMERIC,
  bank_slip NUMERIC,
  raw JSONB NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, period_month, business_id)
);
CREATE INDEX IF NOT EXISTS idx_clinicorp_monthly_summary_month ON clinicorp_monthly_summary(period_month DESC);

-- Log de eventos de webhook (idempotência + auditoria)
CREATE TABLE IF NOT EXISTS clinicorp_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',  -- received | processed | error | ignored
  error_message TEXT,
  payload JSONB NOT NULL,
  headers JSONB,
  ip TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_clinicorp_webhook_received ON clinicorp_webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinicorp_webhook_type ON clinicorp_webhook_events(event_type);
