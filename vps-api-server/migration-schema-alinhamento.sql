-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — alinhamento de schema (deriva código × banco). Idempotente: pode rodar N vezes.
-- Autora: Renata (banco) · 2026-11-05 · Relatório: docs/banco/drift-schema-2026-11-05.md
--
-- Só cria o que o código já usa e não existe: ADD COLUMN IF NOT EXISTS (todas anuláveis,
-- sem DEFAULT volátil, então não reescrevem a tabela) e CREATE TABLE IF NOT EXISTS.
-- Nada de DROP, UPDATE, NOT NULL, índice ou RLS.
--
-- Por que no deploy (como postgres) e não no boot: as tabelas cujo dono é o postgres
-- não aceitam ALTER TABLE vindo da API, porque o usuário da API não é dono delas.
-- O ADD COLUMN do boot falha nelas em silêncio.
--
-- Colunas que NÃO entram de propósito (correção é no código, ver relatório):
--   pacientes.alergias (o dado está em anamneses; uma coluna vazia mostraria "sem alergias"),
--   orcamentos.valor_final (é valor_total), crm_leads.stage (é kanban_stage),
--   estoque.quantidade_atual/custo_unitario (são quantidade/valor_unitario).
--
-- Rollback: são colunas opcionais e podem ficar. Para remover:
--   ALTER TABLE <tabela> DROP COLUMN IF EXISTS <coluna>;  -- perde o que foi gravado nelas
--   DROP TABLE IF EXISTS financeiro_receitas, financeiro_despesas;  -- só se foram criadas aqui
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

-- Agenda: nomes gravados no agendamento (POST/PUT /api/agenda, lembrete 24h, painel do
-- dentista). O PR #27 passa a preencher paciente_nome/dentista_nome.
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS paciente_nome TEXT;
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS dentista_nome TEXT;
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS sala TEXT;
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS valor NUMERIC(12,2);
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS created_by UUID;

-- Painel do dentista (fallback para p.nome já existe no código).
ALTER TABLE IF EXISTS orcamentos  ADD COLUMN IF NOT EXISTS paciente_nome TEXT;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS paciente_nome TEXT;

-- CRM: converter lead em paciente (SELECT ... cpf) e painel comercial (follow-ups).
ALTER TABLE IF EXISTS crm_leads ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE IF EXISTS crm_leads ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS crm_leads ADD COLUMN IF NOT EXISTS last_message TEXT;

-- Campanha "aniversariantes" (resolveCampaignAudience) lê contatos.data_nascimento.
ALTER TABLE IF EXISTS contatos ADD COLUMN IF NOT EXISTS data_nascimento DATE;

-- getTenantIdByInstance grava updated_at.
ALTER TABLE IF EXISTS whatsapp_instances ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- tenant_id que o código já filtra (também no M0 do PR #14, que ainda não entrou).
-- Sem preenchimento aqui: linhas antigas ficam NULL até o M0/P0.
ALTER TABLE IF EXISTS kanban_movements   ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS reactivation_rules ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS reactivation_sends ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS user_roles         ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Quais das tabelas novas já existiam (dono e RLS dessas não são mexidos).
CREATE TEMP TABLE alinhamento_ja_existiam ON COMMIT DROP AS
  SELECT tablename::text AS nome FROM pg_tables
   WHERE schemaname = 'public' AND tablename IN ('password_reset_requests', 'financeiro_receitas', 'financeiro_despesas');

-- Pedidos de troca de senha (GET /api/auth/reset-requests, admin-reset-password).
-- Mesma definição do M0; a rota forgot-password criava a tabela sozinha.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
);
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Projeção financeira do Clinicorp (clinicorp.mjs projectFinanceToLocal). Só as colunas
-- que o código usa; se a tabela já existe na VPS, só garante as colunas.
CREATE TABLE IF NOT EXISTS financeiro_receitas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  valor NUMERIC(12,2),
  data DATE,
  descricao TEXT,
  status TEXT,
  paciente_id UUID,
  clinicorp_external_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS financeiro_despesas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  valor NUMERIC(12,2),
  data DATE,
  descricao TEXT,
  status TEXT,
  clinicorp_external_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE financeiro_receitas ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE financeiro_receitas ADD COLUMN IF NOT EXISTS valor NUMERIC(12,2);
ALTER TABLE financeiro_receitas ADD COLUMN IF NOT EXISTS data DATE;
ALTER TABLE financeiro_receitas ADD COLUMN IF NOT EXISTS descricao TEXT;
ALTER TABLE financeiro_receitas ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE financeiro_receitas ADD COLUMN IF NOT EXISTS paciente_id UUID;
ALTER TABLE financeiro_receitas ADD COLUMN IF NOT EXISTS clinicorp_external_id TEXT;
ALTER TABLE financeiro_despesas ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE financeiro_despesas ADD COLUMN IF NOT EXISTS valor NUMERIC(12,2);
ALTER TABLE financeiro_despesas ADD COLUMN IF NOT EXISTS data DATE;
ALTER TABLE financeiro_despesas ADD COLUMN IF NOT EXISTS descricao TEXT;
ALTER TABLE financeiro_despesas ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE financeiro_despesas ADD COLUMN IF NOT EXISTS clinicorp_external_id TEXT;

-- Tabela CRIADA AGORA (o deploy roda como postgres) passa para o dono das tabelas da API,
-- para a API ter o mesmo acesso que teria se ela mesma a criasse. Tabela que já existia
-- fica com o dono que tem (pode ser uma das que têm o postgres como dono e RLS).
DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['password_reset_requests', 'financeiro_receitas', 'financeiro_despesas'] LOOP
    IF dono IS NOT NULL AND dono <> 'postgres'
       AND NOT EXISTS (SELECT 1 FROM alinhamento_ja_existiam j WHERE j.nome = t)
       AND (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = t) = 'postgres' THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, dono);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO odonto_app', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
