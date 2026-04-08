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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agendamentos_data ON agendamentos(data);
CREATE INDEX IF NOT EXISTS idx_agendamentos_dentista ON agendamentos(dentista_id);
CREATE INDEX IF NOT EXISTS idx_financeiro_data ON financeiro(data);
CREATE INDEX IF NOT EXISTS idx_financeiro_tipo ON financeiro(tipo);
CREATE INDEX IF NOT EXISTS idx_pacientes_nome ON pacientes(nome);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON crm_leads(status);

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
