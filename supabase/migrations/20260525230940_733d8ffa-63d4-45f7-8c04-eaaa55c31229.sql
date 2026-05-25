
-- ============================================================
-- DOMÍNIO 1: AGENDA
-- ============================================================
CREATE TABLE public.dentistas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cro TEXT,
  especialidade TEXT,
  telefone TEXT,
  email TEXT,
  comissao_percentual NUMERIC DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  cor_agenda TEXT DEFAULT '#3B82F6',
  sala TEXT,
  clinicorp_professional_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dentistas_tenant ON public.dentistas(tenant_id);
CREATE UNIQUE INDEX uq_dentistas_tenant_nome ON public.dentistas(tenant_id, lower(trim(nome))) WHERE nome IS NOT NULL AND trim(nome) <> '';

CREATE TABLE public.agendamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  paciente_id UUID REFERENCES public.pacientes(id) ON DELETE SET NULL,
  dentista_id UUID REFERENCES public.dentistas(id) ON DELETE SET NULL,
  data DATE NOT NULL,
  hora TIME NOT NULL,
  duracao INTEGER DEFAULT 30,
  procedimento TEXT,
  status TEXT DEFAULT 'agendado',
  observacoes TEXT,
  clinicorp_appointment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agendamentos_tenant ON public.agendamentos(tenant_id);
CREATE INDEX idx_agendamentos_data ON public.agendamentos(tenant_id, data);
CREATE INDEX idx_agendamentos_dentista ON public.agendamentos(dentista_id);

-- ============================================================
-- DOMÍNIO 2: PRONTUÁRIO
-- ============================================================
CREATE TABLE public.anamneses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  paciente_id UUID NOT NULL UNIQUE REFERENCES public.pacientes(id) ON DELETE CASCADE,
  alergias TEXT[] DEFAULT '{}',
  medicamentos TEXT[] DEFAULT '{}',
  doencas_preexistentes TEXT[] DEFAULT '{}',
  cirurgias_anteriores TEXT[] DEFAULT '{}',
  fumante BOOLEAN DEFAULT false,
  etilista BOOLEAN DEFAULT false,
  gestante BOOLEAN DEFAULT false,
  diabetes BOOLEAN DEFAULT false,
  cardiopatia BOOLEAN DEFAULT false,
  hepatite BOOLEAN DEFAULT false,
  hiv BOOLEAN DEFAULT false,
  hemofilia BOOLEAN DEFAULT false,
  epilepsia BOOLEAN DEFAULT false,
  pressao_arterial TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_anamneses_tenant ON public.anamneses(tenant_id);

CREATE TABLE public.prontuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  paciente_id UUID REFERENCES public.pacientes(id) ON DELETE CASCADE,
  dentista_id UUID REFERENCES public.dentistas(id) ON DELETE SET NULL,
  descricao TEXT,
  odontograma JSONB DEFAULT '{}',
  anexos JSONB DEFAULT '[]',
  tipo TEXT DEFAULT 'evolucao',
  titulo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prontuarios_tenant ON public.prontuarios(tenant_id);
CREATE INDEX idx_prontuarios_paciente ON public.prontuarios(paciente_id);

CREATE TABLE public.odontogramas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  paciente_id UUID NOT NULL UNIQUE REFERENCES public.pacientes(id) ON DELETE CASCADE,
  dentes JSONB DEFAULT '[]',
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_odontogramas_tenant ON public.odontogramas(tenant_id);

CREATE TABLE public.orcamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  paciente_id UUID REFERENCES public.pacientes(id) ON DELETE SET NULL,
  dentista_id UUID REFERENCES public.dentistas(id) ON DELETE SET NULL,
  itens JSONB DEFAULT '[]',
  valor_total NUMERIC(12,2),
  desconto NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pendente',
  validade TIMESTAMPTZ,
  observacoes TEXT,
  forma_pagamento TEXT,
  parcelas INTEGER DEFAULT 1,
  clinicorp_estimate_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orcamentos_tenant ON public.orcamentos(tenant_id);
CREATE INDEX idx_orcamentos_paciente ON public.orcamentos(paciente_id);
CREATE INDEX idx_orcamentos_status ON public.orcamentos(tenant_id, status);

CREATE TABLE public.tratamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  paciente_id UUID REFERENCES public.pacientes(id) ON DELETE CASCADE,
  dentista_id UUID REFERENCES public.dentistas(id) ON DELETE SET NULL,
  orcamento_id UUID REFERENCES public.orcamentos(id) ON DELETE SET NULL,
  descricao TEXT NOT NULL,
  dente TEXT,
  valor NUMERIC(12,2),
  status TEXT DEFAULT 'planejado',
  plano TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tratamentos_tenant ON public.tratamentos(tenant_id);
CREATE INDEX idx_tratamentos_paciente ON public.tratamentos(paciente_id);

CREATE TABLE public.tratamento_etapas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tratamento_id UUID NOT NULL REFERENCES public.tratamentos(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  dente TEXT,
  valor NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','agendado','realizado','cancelado')),
  data_realizada DATE,
  dentista_id UUID REFERENCES public.dentistas(id) ON DELETE SET NULL,
  observacoes TEXT,
  ordem INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tratamento_etapas_tenant ON public.tratamento_etapas(tenant_id);
CREATE INDEX idx_tratamento_etapas_tratamento ON public.tratamento_etapas(tratamento_id);

CREATE TABLE public.clinical_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clinical_reports_tenant ON public.clinical_reports(tenant_id);
CREATE INDEX idx_clinical_reports_patient ON public.clinical_reports(patient_id);

CREATE TABLE public.consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
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
  clinical_report_id UUID REFERENCES public.clinical_reports(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'finalizado',
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_consultations_tenant ON public.consultations(tenant_id);
CREATE INDEX idx_consultations_patient ON public.consultations(patient_id);

-- ============================================================
-- DOMÍNIO 3: CRM / ATENDIMENTO / WHATSAPP
-- ============================================================
CREATE TABLE public.attendance_queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  icon TEXT DEFAULT '📋',
  description TEXT,
  whatsapp_button_label TEXT,
  contact_numbers JSONB DEFAULT '[]',
  team_member_ids JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attendance_queues_tenant ON public.attendance_queues(tenant_id);

CREATE TABLE public.lead_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  icon TEXT DEFAULT '📌',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_tags_tenant ON public.lead_tags(tenant_id);

CREATE TABLE public.lead_tag_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL,
  tag_id UUID NOT NULL REFERENCES public.lead_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, tag_id)
);
CREATE INDEX idx_lead_tag_assignments_tenant ON public.lead_tag_assignments(tenant_id);

CREATE TABLE public.contatos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  tipo TEXT DEFAULT 'pessoal',
  empresa TEXT,
  cargo TEXT,
  observacoes TEXT,
  avatar_url TEXT,
  favorito BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contatos_tenant ON public.contatos(tenant_id);
CREATE INDEX idx_contatos_telefone ON public.contatos(tenant_id, telefone);

CREATE TABLE public.crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  origem TEXT,
  status TEXT DEFAULT 'novo',
  observacoes TEXT,
  avatar_url TEXT,
  queue_id UUID REFERENCES public.attendance_queues(id) ON DELETE SET NULL,
  queue_name TEXT,
  awaiting_queue_selection BOOLEAN DEFAULT false,
  kanban_stage TEXT DEFAULT 'lead',
  consciousness_level TEXT,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_to_name TEXT,
  valor NUMERIC(12,2) DEFAULT 0,
  orcamento_id UUID REFERENCES public.orcamentos(id) ON DELETE SET NULL,
  paciente_id UUID REFERENCES public.pacientes(id) ON DELETE SET NULL,
  priority BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_crm_leads_tenant ON public.crm_leads(tenant_id);
CREATE INDEX idx_crm_leads_status ON public.crm_leads(tenant_id, status);
CREATE INDEX idx_crm_leads_kanban ON public.crm_leads(tenant_id, kanban_stage);

CREATE TABLE public.attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL,
  lead_name TEXT,
  lead_phone TEXT,
  attendant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  attendant_name TEXT,
  queue_id TEXT,
  queue_name TEXT,
  started_waiting_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting','active','closed')),
  wait_time_seconds INTEGER,
  response_time_seconds INTEGER,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attendance_sessions_tenant ON public.attendance_sessions(tenant_id);
CREATE INDEX idx_attendance_sessions_status ON public.attendance_sessions(tenant_id, status);

CREATE TABLE public.satisfaction_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
  lead_id TEXT NOT NULL,
  lead_phone TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  attendant_id UUID,
  attendant_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_satisfaction_tenant ON public.satisfaction_ratings(tenant_id);

CREATE TABLE public.transfer_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL,
  lead_name TEXT,
  lead_phone TEXT,
  from_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  from_user_name TEXT,
  to_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_user_name TEXT,
  reason TEXT NOT NULL,
  queue_id TEXT,
  queue_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transfer_logs_tenant ON public.transfer_logs(tenant_id);

CREATE TABLE public.chat_messages (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL,
  content TEXT,
  sender TEXT NOT NULL CHECK (sender IN ('lead','attendant','system')),
  type TEXT NOT NULL DEFAULT 'text',
  status TEXT DEFAULT 'sent',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  media_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  reply_to_id TEXT,
  reply_to_content TEXT,
  reply_to_sender TEXT,
  attendant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  attendant_name TEXT,
  instance TEXT,
  phone TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_tenant ON public.chat_messages(tenant_id);
CREATE INDEX idx_chat_messages_lead ON public.chat_messages(lead_id, timestamp DESC);

CREATE TABLE public.chat_read_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, user_id)
);
CREATE INDEX idx_chat_read_status_tenant ON public.chat_read_status(tenant_id);

CREATE TABLE public.kanban_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  moved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  moved_by_name TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kanban_movements_tenant ON public.kanban_movements(tenant_id);

-- ============================================================
-- DOMÍNIO 4: REATIVAÇÃO
-- ============================================================
CREATE TABLE public.reactivation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  inactive_days INTEGER NOT NULL DEFAULT 180 CHECK (inactive_days >= 1),
  origin TEXT NOT NULL DEFAULT 'todos',
  message_template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('ativo','pausado','rascunho')),
  created_by UUID,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reactivation_rules_tenant ON public.reactivation_rules(tenant_id);

CREATE TABLE public.reactivation_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES public.reactivation_rules(id) ON DELETE CASCADE,
  paciente_id UUID,
  lead_id UUID,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','falhou','respondido')),
  error_message TEXT,
  responded_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reactivation_sends_tenant ON public.reactivation_sends(tenant_id);

-- ============================================================
-- DOMÍNIO 5: FINANCEIRO
-- ============================================================
CREATE TABLE public.financeiro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('receita','despesa')),
  descricao TEXT,
  valor NUMERIC(12,2) NOT NULL,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  categoria TEXT,
  paciente_id UUID REFERENCES public.pacientes(id) ON DELETE SET NULL,
  forma_pagamento TEXT,
  status TEXT DEFAULT 'pago',
  vencimento DATE,
  parcelas INTEGER DEFAULT 1,
  parcela_atual INTEGER DEFAULT 1,
  recorrente BOOLEAN DEFAULT false,
  observacoes TEXT,
  clinicorp_financial_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_financeiro_tenant ON public.financeiro(tenant_id);
CREATE INDEX idx_financeiro_data ON public.financeiro(tenant_id, data);

CREATE TABLE public.comissoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dentista_id UUID REFERENCES public.dentistas(id) ON DELETE SET NULL,
  tratamento_id UUID REFERENCES public.tratamentos(id) ON DELETE SET NULL,
  paciente_id UUID REFERENCES public.pacientes(id) ON DELETE SET NULL,
  valor NUMERIC(12,2),
  percentual NUMERIC(5,2),
  data DATE DEFAULT CURRENT_DATE,
  pago BOOLEAN DEFAULT false,
  descricao TEXT,
  procedimento TEXT,
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','pago')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comissoes_tenant ON public.comissoes(tenant_id);

CREATE TABLE public.estoque (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  categoria TEXT,
  quantidade INTEGER DEFAULT 0,
  quantidade_minima INTEGER DEFAULT 5,
  unidade TEXT DEFAULT 'un',
  valor_unitario NUMERIC(10,2),
  fornecedor TEXT,
  localizacao TEXT,
  validade DATE,
  lote TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_estoque_tenant ON public.estoque(tenant_id);

CREATE TABLE public.estoque_movimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.estoque(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida','ajuste')),
  quantidade INTEGER NOT NULL,
  motivo TEXT,
  usuario_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_estoque_movimentos_tenant ON public.estoque_movimentos(tenant_id);

CREATE TABLE public.fin_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  bank VARCHAR(100) NOT NULL,
  agency VARCHAR(20) DEFAULT '',
  account VARCHAR(30) DEFAULT '',
  type VARCHAR(20) DEFAULT 'corrente' CHECK (type IN ('corrente','poupanca','investimento')),
  balance NUMERIC(14,2) DEFAULT 0,
  color VARCHAR(30) DEFAULT 'hsl(217, 91%, 60%)',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fin_bank_accounts_tenant ON public.fin_bank_accounts(tenant_id);

CREATE TABLE public.fin_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  role VARCHAR(100) NOT NULL,
  cpf VARCHAR(20) DEFAULT '',
  admission_date VARCHAR(15) DEFAULT '',
  salary NUMERIC(12,2) DEFAULT 0,
  benefits NUMERIC(12,2) DEFAULT 0,
  bank_account_id UUID REFERENCES public.fin_bank_accounts(id) ON DELETE SET NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fin_employees_tenant ON public.fin_employees(tenant_id);

CREATE TABLE public.fin_payrolls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.fin_employees(id) ON DELETE CASCADE,
  employee_name VARCHAR(150) NOT NULL,
  month VARCHAR(10) NOT NULL,
  gross_salary NUMERIC(12,2) DEFAULT 0,
  benefits NUMERIC(12,2) DEFAULT 0,
  deductions NUMERIC(12,2) DEFAULT 0,
  net_salary NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente','pago')),
  payment_date VARCHAR(15),
  bank_account_id UUID REFERENCES public.fin_bank_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fin_payrolls_tenant ON public.fin_payrolls(tenant_id);

CREATE TABLE public.fin_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  description VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  value NUMERIC(12,2) NOT NULL,
  due_date VARCHAR(15) NOT NULL,
  status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente','pago','vencido')),
  supplier VARCHAR(150),
  bank_account_id UUID REFERENCES public.fin_bank_accounts(id) ON DELETE SET NULL,
  payment_date VARCHAR(15),
  recurrent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fin_bills_tenant ON public.fin_bills(tenant_id);

CREATE TABLE public.fin_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL CHECK (type IN ('entrada','saida')),
  description VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  value NUMERIC(12,2) NOT NULL,
  date VARCHAR(15) NOT NULL,
  bank_account_id UUID REFERENCES public.fin_bank_accounts(id) ON DELETE SET NULL,
  bank_name VARCHAR(100) DEFAULT '',
  patient VARCHAR(150),
  bill_id UUID REFERENCES public.fin_bills(id) ON DELETE SET NULL,
  payroll_id UUID REFERENCES public.fin_payrolls(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fin_movements_tenant ON public.fin_movements(tenant_id);

CREATE TABLE public.fin_overdue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient VARCHAR(150) NOT NULL,
  value NUMERIC(12,2) NOT NULL,
  days_late INT DEFAULT 0,
  procedure VARCHAR(150) DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fin_overdue_tenant ON public.fin_overdue(tenant_id);

-- ============================================================
-- DOMÍNIO 6: META ADS
-- ============================================================
CREATE TABLE public.meta_ads_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  access_token TEXT,
  connected BOOLEAN DEFAULT false,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_meta_ads_accounts_tenant ON public.meta_ads_accounts(tenant_id);

CREATE TABLE public.meta_ads_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE',
  objective TEXT,
  daily_budget NUMERIC(12,2),
  lifetime_budget NUMERIC(12,2),
  start_time TIMESTAMPTZ,
  stop_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_meta_ads_campaigns_tenant ON public.meta_ads_campaigns(tenant_id);

CREATE TABLE public.meta_ads_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  date_start DATE NOT NULL,
  date_stop DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend NUMERIC(12,2) DEFAULT 0,
  reach INTEGER DEFAULT 0,
  ctr NUMERIC(8,4) DEFAULT 0,
  cpc NUMERIC(8,2) DEFAULT 0,
  cpm NUMERIC(8,2) DEFAULT 0,
  actions JSONB DEFAULT '[]',
  leads INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cost_per_lead NUMERIC(8,2),
  cost_per_conversion NUMERIC(8,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, date_start)
);
CREATE INDEX idx_meta_ads_insights_tenant ON public.meta_ads_insights(tenant_id);

-- ============================================================
-- DOMÍNIO 7: CLINICORP
-- ============================================================
CREATE TABLE public.clinicorp_settings (
  id SERIAL PRIMARY KEY,
  enabled BOOLEAN DEFAULT false,
  api_token TEXT,
  subscriber_id TEXT,
  webhook_secret TEXT,
  base_url TEXT DEFAULT 'https://api.clinicorp.com/rest/v1',
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.clinicorp_user_settings (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  api_token TEXT,
  subscriber_id TEXT,
  webhook_secret TEXT,
  base_url TEXT DEFAULT 'https://api.clinicorp.com/rest/v1',
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.clinicorp_clinics (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id BIGINT, business_name TEXT, name TEXT, email TEXT, address TEXT,
  active TEXT, landline BIGINT, other_landline BIGINT, slot_time INT,
  no_limit_apt_same_time TEXT, subscriber_business_uid TEXT,
  working_days_hours JSONB, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE public.clinicorp_professionals (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name TEXT, user_name TEXT, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE public.clinicorp_chairs (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  business_id BIGINT, name TEXT, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE public.clinicorp_appointment_categories (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  description TEXT, color TEXT, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE public.clinicorp_specialties (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  description TEXT, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE public.clinicorp_patients (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT, email TEXT, mobile_phone TEXT, birth_date DATE,
  sex TEXT, document_id TEXT, notes TEXT, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);
CREATE INDEX idx_clinicorp_patients_phone ON public.clinicorp_patients(mobile_phone);

CREATE TABLE public.clinicorp_appointments (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  business_id BIGINT, patient_id BIGINT, patient_name TEXT,
  professional_id BIGINT, professional_name TEXT,
  category_id BIGINT, category_description TEXT, category_color TEXT,
  chair_id BIGINT, status TEXT, date DATE,
  from_time TEXT, to_time TEXT, notes TEXT, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);
CREATE INDEX idx_clinicorp_appts_date ON public.clinicorp_appointments(tenant_id, date);

CREATE TABLE public.clinicorp_estimates (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  treatment_id BIGINT, patient_id BIGINT, patient_name TEXT,
  professional_id BIGINT, professional_name TEXT, business_id BIGINT,
  amount NUMERIC, status TEXT, date DATE, create_date DATE,
  procedure_list JSONB, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE public.clinicorp_financial_entries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT,
  business_id BIGINT,
  patient_id BIGINT,
  amount NUMERIC,
  date DATE,
  description TEXT,
  raw JSONB NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_clinicorp_fin_tenant ON public.clinicorp_financial_entries(tenant_id);

CREATE TABLE public.clinicorp_monthly_summary (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  period_month DATE NOT NULL,
  business_id BIGINT NOT NULL DEFAULT 0,
  total_in NUMERIC, total_out NUMERIC, total_amount NUMERIC,
  cash NUMERIC, credit_card NUMERIC, debit_card NUMERIC,
  pix NUMERIC, bank_slip NUMERIC,
  raw JSONB NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_clinicorp_monthly_tenant ON public.clinicorp_monthly_summary(tenant_id);

CREATE TABLE public.clinicorp_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','error','ignored')),
  error_message TEXT,
  payload JSONB NOT NULL,
  headers JSONB,
  ip TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE public.clinicorp_evolutions (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id BIGINT, professional_id BIGINT, treatment_id BIGINT,
  description TEXT, date TIMESTAMPTZ, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE public.clinicorp_documents (
  id BIGINT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id BIGINT, title TEXT, file_url TEXT,
  category TEXT, date DATE, raw JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE public.clinicorp_push_log (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  local_id TEXT NOT NULL,
  clinicorp_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB,
  response JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DOMÍNIO 8: EXAMES
-- ============================================================
CREATE TABLE public.exame_tipos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  categoria TEXT,
  codigo_tiss TEXT,
  preco NUMERIC(10,2) DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);

CREATE TABLE public.exames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  codigo TEXT,
  paciente_id UUID REFERENCES public.pacientes(id) ON DELETE SET NULL,
  dentista_solicitante_id UUID REFERENCES public.dentistas(id) ON DELETE SET NULL,
  clinica_origem TEXT,
  tipo_exame_id UUID REFERENCES public.exame_tipos(id) ON DELETE SET NULL,
  tipo_nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','em_andamento','aguardando_laudo','concluido','entregue','cancelado')),
  prioridade TEXT NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('baixa','normal','alta','urgente')),
  data_solicitacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_realizacao TIMESTAMPTZ,
  data_entrega TIMESTAMPTZ,
  valor NUMERIC(10,2) DEFAULT 0,
  modo_entrega TEXT,
  laudo_texto TEXT,
  arquivo_url TEXT,
  observacoes TEXT,
  terceirizado BOOLEAN NOT NULL DEFAULT false,
  fornecedor_terc TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_exames_tenant ON public.exames(tenant_id);
CREATE INDEX idx_exames_status ON public.exames(tenant_id, status);

-- ============================================================
-- DOMÍNIO 9: CONFIGURAÇÕES
-- ============================================================
CREATE TABLE public.ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL UNIQUE CHECK (provider IN ('openai','manus')),
  api_key TEXT NOT NULL,
  model TEXT DEFAULT 'gpt-4o-mini',
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  sound_type VARCHAR(20) NOT NULL DEFAULT 'ding',
  sound_volume INTEGER NOT NULL DEFAULT 70,
  recovery_sound_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DOMÍNIO 10: NOTIFICAÇÕES
-- ============================================================
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subscriptions_tenant ON public.push_subscriptions(tenant_id);
CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions(user_id);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
DO $$
DECLARE
  t TEXT;
  tbls TEXT[] := ARRAY[
    'dentistas','agendamentos','anamneses','prontuarios','odontogramas','orcamentos','tratamentos','tratamento_etapas','consultations',
    'attendance_queues','lead_tags','contatos','crm_leads',
    'reactivation_rules','financeiro','comissoes','estoque','fin_bank_accounts','fin_employees','fin_payrolls','fin_bills',
    'meta_ads_campaigns','clinicorp_settings','clinicorp_user_settings',
    'exame_tipos','exames','ai_settings','app_settings','system_settings','user_preferences','push_subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END $$;

-- ============================================================
-- RLS: habilitar em todas as tabelas
-- ============================================================
DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'dentistas','agendamentos','anamneses','prontuarios','odontogramas','orcamentos','tratamentos','tratamento_etapas','clinical_reports','consultations',
    'attendance_queues','lead_tags','lead_tag_assignments','contatos','crm_leads','attendance_sessions','satisfaction_ratings','transfer_logs','chat_messages','chat_read_status','kanban_movements',
    'reactivation_rules','reactivation_sends',
    'financeiro','comissoes','estoque','estoque_movimentos','fin_bank_accounts','fin_employees','fin_payrolls','fin_bills','fin_movements','fin_overdue',
    'meta_ads_accounts','meta_ads_campaigns','meta_ads_insights',
    'clinicorp_clinics','clinicorp_professionals','clinicorp_chairs','clinicorp_appointment_categories','clinicorp_specialties','clinicorp_patients','clinicorp_appointments','clinicorp_estimates','clinicorp_financial_entries','clinicorp_monthly_summary','clinicorp_evolutions','clinicorp_documents',
    'exame_tipos','exames','user_preferences','push_subscriptions'
  ];
  global_tables TEXT[] := ARRAY[
    'clinicorp_settings','clinicorp_user_settings','clinicorp_webhook_events','clinicorp_push_log','ai_settings','app_settings','system_settings'
  ];
BEGIN
  -- Tabelas com tenant_id: políticas por tenant
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid())) WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()))',
      t || '_tenant_isolation', t
    );
  END LOOP;

  -- Tabelas globais: somente super_admin
  FOREACH t IN ARRAY global_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()))',
      t || '_super_admin_only', t
    );
  END LOOP;
END $$;

-- clinicorp_user_settings: usuário pode gerenciar o próprio (sobreposto à policy super_admin)
CREATE POLICY "clinicorp_user_settings_own" ON public.clinicorp_user_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- app_settings/system_settings: leitura aberta para autenticados (são configs globais visíveis)
CREATE POLICY "app_settings_read_all" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "system_settings_read_all" ON public.system_settings FOR SELECT TO authenticated USING (true);
