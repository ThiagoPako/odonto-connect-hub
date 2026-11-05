-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — alinhamento de schema (deriva código × banco). Idempotente: pode rodar N vezes.
-- Autora: Renata (banco) · 2026-11-05 · Relatório: docs/banco/drift-schema-2026-11-05.md
--
-- Só cria o que o código já usa e não existe: ADD COLUMN IF NOT EXISTS (todas anuláveis,
-- sem DEFAULT volátil, então não reescrevem a tabela) e CREATE TABLE IF NOT EXISTS.
-- Nada de DROP, UPDATE, NOT NULL em coluna existente ou RLS. Índices só nas tabelas novas e no
-- índice único que o upsert do Clinicorp exige.
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
--   DROP TABLE IF EXISTS exames, exame_tipos;   -- perde os pedidos de exame gravados (dado de saúde: backup antes)
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

-- Agenda: nomes gravados no agendamento (POST/PUT /api/agenda, lembrete 24h, painel do
-- dentista). O PR #27 passa a preencher paciente_nome/dentista_nome.
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS paciente_nome TEXT;
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS dentista_nome TEXT;
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS sala TEXT;  -- já existe em produção (no-op)
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

-- Cadastro de clínica nova (POST /api/auth/signup-clinic, server.mjs:1192): aceite dos
-- Termos/Política. O boot tenta criar, mas falha em produção (tenants tem o postgres como dono).
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS termos_versao TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS politica_versao TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS termos_aceitos_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS termos_aceite_ip TEXT;

-- Clinicorp: resumo mensal e log de push gravam tenant_id (clinicorp.mjs:1207, 1860, 2099).
-- O upsert do resumo usa ON CONFLICT (source, period_month, business_id, tenant_id), que precisa
-- deste índice único (o boot cria, mas falha em produção). A constraint antiga em 3 colunas
-- não é removida aqui (seria DROP); com uma clínica só no Clinicorp ela não conflita.
ALTER TABLE IF EXISTS clinicorp_monthly_summary ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS clinicorp_push_log        ADD COLUMN IF NOT EXISTS tenant_id UUID;
DO $$
BEGIN
  IF to_regclass('public.clinicorp_monthly_summary') IS NOT NULL THEN
    BEGIN  -- linha duplicada não pode derrubar o resto da migração
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clinicorp_monthly_summary_tenant_period
        ON clinicorp_monthly_summary (source, period_month, business_id, tenant_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING '[alinhamento] clinicorp_monthly_summary tem linhas duplicadas; índice único não criado (upsert do resumo mensal segue falhando)';
    END;
  END IF;
  IF to_regclass('public.clinicorp_push_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_clinicorp_push_log_tenant ON clinicorp_push_log (tenant_id, created_at DESC);
  END IF;
END $$;

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
   WHERE schemaname = 'public' AND tablename IN ('password_reset_requests', 'financeiro_receitas', 'financeiro_despesas',
                                                 'exame_tipos', 'exames');

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

-- Módulo Exames (rotas /api/exame-tipos e /api/exames, server.mjs:15733-15960): as tabelas
-- não existem em produção e migration-exames.sql nunca entrou no deploy. Mesmas colunas de
-- migration-exames.sql (conferidas com o código de main e do PR #33), com tenant_id NOT NULL
-- (as rotas sempre gravam o tenant). Sem DROP TRIGGER/POLICY e sem seed de preços: o catálogo
-- começa vazio e cada clínica cadastra os próprios tipos. RLS fica com migration-force-rls.sql.
CREATE TABLE IF NOT EXISTS exame_tipos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  categoria     text,
  codigo_tiss   text,
  preco         numeric(10,2) DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_exame_tipos_tenant ON exame_tipos (tenant_id);

CREATE TABLE IF NOT EXISTS exames (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  codigo            text,
  paciente_id       uuid REFERENCES pacientes(id) ON DELETE SET NULL,
  dentista_solicitante_id uuid REFERENCES dentistas(id) ON DELETE SET NULL,
  clinica_origem    text,
  tipo_exame_id     uuid REFERENCES exame_tipos(id) ON DELETE SET NULL,
  tipo_nome         text NOT NULL,
  status            text NOT NULL DEFAULT 'novo'
                    CHECK (status IN ('novo','em_andamento','aguardando_laudo','concluido','entregue','cancelado')),
  prioridade        text NOT NULL DEFAULT 'normal'
                    CHECK (prioridade IN ('baixa','normal','alta','urgente')),
  data_solicitacao  timestamptz NOT NULL DEFAULT now(),
  data_realizacao   timestamptz,
  data_entrega      timestamptz,
  valor             numeric(10,2) DEFAULT 0,
  modo_entrega      text,
  laudo_texto       text,
  arquivo_url       text,
  observacoes       text,
  terceirizado      boolean NOT NULL DEFAULT false,
  fornecedor_terc   text,
  created_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exames_tenant     ON exames (tenant_id);
CREATE INDEX IF NOT EXISTS idx_exames_status     ON exames (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_exames_paciente   ON exames (tenant_id, paciente_id);
CREATE INDEX IF NOT EXISTS idx_exames_data_solic ON exames (tenant_id, data_solicitacao DESC);

CREATE OR REPLACE FUNCTION exames_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_exames_updated' AND tgrelid = 'public.exames'::regclass) THEN
    CREATE TRIGGER trg_exames_updated BEFORE UPDATE ON exames FOR EACH ROW EXECUTE FUNCTION exames_touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_exame_tipos_updated' AND tgrelid = 'public.exame_tipos'::regclass) THEN
    CREATE TRIGGER trg_exame_tipos_updated BEFORE UPDATE ON exame_tipos FOR EACH ROW EXECUTE FUNCTION exames_touch_updated_at();
  END IF;
END $$;

-- Tabela CRIADA AGORA (o deploy roda como postgres) passa para o dono das tabelas da API,
-- para a API ter o mesmo acesso que teria se ela mesma a criasse. Tabela que já existia
-- fica com o dono que tem (pode ser uma das que têm o postgres como dono e RLS).
DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['password_reset_requests', 'financeiro_receitas', 'financeiro_despesas', 'exame_tipos', 'exames'] LOOP
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
