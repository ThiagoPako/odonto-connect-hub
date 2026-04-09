-- ═══════════════════════════════════════════════════════════
-- Odonto Connect — PostgreSQL Migration
-- Run: psql -U odonto_user -d odonto_db -f migration.sql
-- ═══════════════════════════════════════════════════════════

-- Roles enum
CREATE TYPE app_role AS ENUM ('admin', 'dentista', 'recepcionista', 'user');

-- Profiles (auth)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'user',
  avatar_url TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  UNIQUE (user_id, role)
);

-- Pacientes
CREATE TABLE IF NOT EXISTS pacientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cpf TEXT UNIQUE,
  telefone TEXT,
  email TEXT,
  data_nascimento DATE,
  endereco TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dentistas
CREATE TABLE IF NOT EXISTS dentistas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cro TEXT UNIQUE,
  especialidade TEXT,
  telefone TEXT,
  email TEXT,
  comissao_percentual NUMERIC DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agendamentos
CREATE TABLE IF NOT EXISTS agendamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id UUID REFERENCES pacientes(id),
  dentista_id UUID REFERENCES dentistas(id),
  data DATE NOT NULL,
  hora TIME NOT NULL,
  duracao INTEGER DEFAULT 30,
  procedimento TEXT,
  status TEXT DEFAULT 'agendado',
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Financeiro
CREATE TABLE IF NOT EXISTS financeiro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
  descricao TEXT,
  valor NUMERIC(12,2) NOT NULL,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  categoria TEXT,
  paciente_id UUID REFERENCES pacientes(id),
  forma_pagamento TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tratamentos
CREATE TABLE IF NOT EXISTS tratamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id UUID REFERENCES pacientes(id),
  dentista_id UUID REFERENCES dentistas(id),
  descricao TEXT NOT NULL,
  dente TEXT,
  valor NUMERIC(12,2),
  status TEXT DEFAULT 'planejado',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orçamentos
CREATE TABLE IF NOT EXISTS orcamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id UUID REFERENCES pacientes(id),
  dentista_id UUID REFERENCES dentistas(id),
  itens JSONB DEFAULT '[]',
  valor_total NUMERIC(12,2),
  desconto NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pendente',
  validade DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CRM Leads
CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  origem TEXT,
  status TEXT DEFAULT 'novo',
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Estoque
CREATE TABLE IF NOT EXISTS estoque (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  categoria TEXT,
  quantidade INTEGER DEFAULT 0,
  quantidade_minima INTEGER DEFAULT 5,
  unidade TEXT DEFAULT 'un',
  valor_unitario NUMERIC(10,2),
  fornecedor TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comissões
CREATE TABLE IF NOT EXISTS comissoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dentista_id UUID REFERENCES dentistas(id),
  tratamento_id UUID REFERENCES tratamentos(id),
  valor NUMERIC(12,2),
  percentual NUMERIC(5,2),
  data DATE DEFAULT CURRENT_DATE,
  pago BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prontuários
CREATE TABLE IF NOT EXISTS prontuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id UUID REFERENCES pacientes(id),
  dentista_id UUID REFERENCES dentistas(id),
  descricao TEXT,
  odontograma JSONB DEFAULT '{}',
  anexos JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add active column to profiles (run if upgrading)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agendamentos_data ON agendamentos(data);
CREATE INDEX IF NOT EXISTS idx_agendamentos_dentista ON agendamentos(dentista_id);
CREATE INDEX IF NOT EXISTS idx_financeiro_data ON financeiro(data);
CREATE INDEX IF NOT EXISTS idx_financeiro_tipo ON financeiro(tipo);
CREATE INDEX IF NOT EXISTS idx_pacientes_nome ON pacientes(nome);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON crm_leads(status);

-- Add avatar_url to crm_leads (WhatsApp profile picture)
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create admin user (password: admin123 — CHANGE IN PRODUCTION!)
INSERT INTO profiles (id, name, email, role, password_hash)
VALUES (
  gen_random_uuid(),
  'Administrador',
  'admin@odontoconnect.tech',
  'admin',
  '$2b$12$LJ3m4ys3uz2JVbEMKMYNWOxGMOlJPwJq2y5n0yY3vQIhzYUG0Qk2W'
) ON CONFLICT (email) DO NOTHING;

-- Set admin role
INSERT INTO user_roles (user_id, role)
SELECT id, 'admin' FROM profiles WHERE email = 'admin@odontoconnect.tech'
ON CONFLICT (user_id, role) DO NOTHING;

-- Transfer logs (auditoria de transferências de atendimento)
CREATE TABLE IF NOT EXISTS transfer_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT NOT NULL,
  lead_name TEXT,
  lead_phone TEXT,
  from_user_id UUID REFERENCES profiles(id),
  from_user_name TEXT,
  to_user_id UUID REFERENCES profiles(id),
  to_user_name TEXT,
  reason TEXT NOT NULL,
  queue_id TEXT,
  queue_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_logs_created ON transfer_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_logs_lead ON transfer_logs(lead_id);

-- Filas de atendimento (setores da clínica)
CREATE TABLE IF NOT EXISTS attendance_queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  icon TEXT DEFAULT '📋',
  description TEXT,
  whatsapp_button_label TEXT,
  contact_numbers JSONB DEFAULT '[]',
  team_member_ids JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track which queue a lead selected (for routing)
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS queue_id UUID REFERENCES attendance_queues(id);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS queue_name TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS awaiting_queue_selection BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_attendance_queues_active ON attendance_queues(active);

-- App settings (key-value store for attendance config, etc.)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attendance sessions (tempo de espera, atendimento, etc.)
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_status ON attendance_sessions(status);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_attendant ON attendance_sessions(attendant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_created ON attendance_sessions(created_at DESC);

-- Satisfaction ratings (avaliação pós-atendimento via WhatsApp)
CREATE TABLE IF NOT EXISTS satisfaction_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES attendance_sessions(id),
  lead_id TEXT NOT NULL,
  lead_phone TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  attendant_id UUID,
  attendant_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_ratings_attendant ON satisfaction_ratings(attendant_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_ratings_created ON satisfaction_ratings(created_at DESC);

-- Lead Tags (tags personalizáveis para classificar leads)
CREATE TABLE IF NOT EXISTS lead_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  icon TEXT DEFAULT '📌',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lead <-> Tag assignments
CREATE TABLE IF NOT EXISTS lead_tag_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT NOT NULL,
  tag_id UUID REFERENCES lead_tags(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (lead_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_tag_assignments_lead ON lead_tag_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tag_assignments_tag ON lead_tag_assignments(tag_id);

-- Contatos (lista de contatos do WhatsApp / clínica)
CREATE TABLE IF NOT EXISTS contatos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  tipo TEXT DEFAULT 'pessoal',
  empresa TEXT,
  cargo TEXT,
  observacoes TEXT,
  avatar_url TEXT,
  favorito BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contatos_nome ON contatos(nome);
CREATE INDEX IF NOT EXISTS idx_contatos_telefone ON contatos(telefone);

-- Insert default tags
INSERT INTO lead_tags (id, name, color, icon) VALUES
  (gen_random_uuid(), 'Urgente', '#EF4444', '🔴'),
  (gen_random_uuid(), 'VIP', '#F59E0B', '⭐'),
  (gen_random_uuid(), 'Retorno', '#3B82F6', '🔄'),
  (gen_random_uuid(), 'Novo', '#10B981', '🆕'),
  (gen_random_uuid(), 'Orçamento', '#8B5CF6', '💰')
ON CONFLICT DO NOTHING;
