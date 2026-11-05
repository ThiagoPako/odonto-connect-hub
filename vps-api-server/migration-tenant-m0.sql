-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — M0: tenant_id onde falta + preenchimento + tenant_settings
-- Autora: Renata (banco) · 2026-11-05 · Pré-requisito dos lotes L1, L2, L3, L4, L5 e L6
-- (varredura de isolamento entre clínicas).
--
-- Por quê: várias tabelas da clínica não têm tenant_id, ou têm a coluna com as linhas
-- antigas em NULL. Corrigir a rota (WHERE tenant_id = $n) antes disso deixaria a tela
-- da própria clínica vazia.
--
-- SÓ ADITIVO. Pode rodar sozinho, antes da migration-force-rls.sql, e em todo deploy:
--   • ADD COLUMN tenant_id (nula, DEFAULT get_current_tenant_id(), FK tenants) e índice;
--   • preenche tenant_id NULL só por pai identificável, e só quando o pai aponta para
--     UMA clínica (nunca "primeiro admin", nunca tenant fixo);
--   • cria a tabela tenant_settings (configuração por clínica, substitui app_settings);
--   • lista no fim (NOTICE) o que ficou sem clínica, para revisão.
-- NÃO faz: RLS/FORCE/políticas (isso é a migration-force-rls.sql), NOT NULL, DROP de
-- constraint, mudança de dados que já têm clínica, nem mudança no comportamento da API
-- (nenhuma rota lê essas colunas ainda; INSERT com usuário logado passa a gravar a clínica).
--
-- Ficam só com a coluna, sem preenchimento (precisam de código, lotes L2/L4/L6):
--   clinica_config  — linha única (CHECK id = 1) usada por todas as clínicas; tornar por
--                     clínica exige trocar a chave, fica para o L2.
--   ai_settings     — UNIQUE(provider) global; NULL = configuração global atual (L6).
--   agenda_marcadores — UNIQUE(nome) global; trocar por UNIQUE(tenant_id, nome) fica
--                     para o L2 (é DROP de constraint).
--
-- Rollback: nada a desfazer com urgência — colunas nulas e opcionais, nenhuma rota
-- depende delas. Para remover de vez (perde a clínica preenchida):
--   ALTER TABLE <tabela> DROP COLUMN IF EXISTS tenant_id;   -- só nas tabelas que o M0 criou a coluna
--   DROP TABLE IF EXISTS tenant_settings;                    -- perde as configurações por clínica gravadas
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- Se não conseguir o lock em 5 s, desfaz tudo e o próximo deploy tenta de novo
-- (não trava a API esperando atrás de uma consulta longa).
SET LOCAL lock_timeout = '5s';

-- Mesma definição de migration-tenant-defaults.sql ('' vira NULL).
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
  BEGIN
    RETURN NULLIF(current_setting('app.tenant_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql STABLE;

-- ─── 1. tenant_settings ─────────────────────────────────────────────────────
-- Configuração por clínica (attendance_settings, solution_hours, followup etc.).
-- Mesmo formato de app_settings, com a clínica na chave.
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key)
);

-- Tabela que a rota forgot-password criava sozinha (agora não cria mais).
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- O deploy roda como postgres. Tabela criada aqui passa para o mesmo dono das tabelas
-- da API (dono de pacientes), para a API atual continuar com o mesmo acesso de hoje.
-- Se o role odonto_app já existir (migration-force-rls.sql), recebe o DML.
DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_settings', 'password_reset_requests'] LOOP
    IF dono IS NOT NULL AND dono <> 'postgres'
       AND (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = t) = 'postgres' THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, dono);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO odonto_app', t);
    END IF;
  END LOOP;
END $$;

-- ─── 2. tenant_id + DEFAULT + índice ────────────────────────────────────────
-- Só altera a tabela se precisar (ALTER TABLE trava a tabela mesmo com IF NOT EXISTS).
DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'prontuarios', 'anamneses', 'odontogramas', 'comissoes', 'orcamentos', 'financeiro',
    'tratamentos', 'tratamento_etapas', 'procedimento_execucoes', 'assinaturas_eletronicas',
    'procedimentos_catalogo', 'procedimentos_catalogo_versoes',
    'fin_bank_accounts', 'fin_employees', 'fin_payrolls', 'fin_bills', 'fin_movements', 'fin_overdue',
    'estoque', 'estoque_movimentos', 'contatos', 'lead_tags', 'lead_tag_assignments',
    'kanban_movements', 'transfer_logs', 'satisfaction_ratings',
    'clinical_reports', 'consultations',
    'meta_ads_accounts', 'meta_ads_campaigns', 'meta_ads_insights',
    'ai_settings', 'agenda_marcadores', 'clinica_config',
    'user_preferences', 'push_subscriptions', 'password_reset_requests'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE '[M0] % não existe neste banco: ignorada', t;
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id') THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE', t);
      RAISE NOTICE '[M0] coluna tenant_id criada em %', t;
    END IF;

    -- INSERT de usuário logado sem tenant_id grava a clínica do contexto da requisição.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
                  AND data_type = 'uuid' AND column_default IS NULL) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id()', t);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = format('public.%I', t)::regclass AND a.attname = 'tenant_id'
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)', 'idx_' || t || '_tenant_rls', t);
    END IF;
  END LOOP;
END $$;

-- ─── 3. Preenchimento por pai identificável ─────────────────────────────────
-- Copia a clínica do pai para a filha com tenant_id NULL, só quando todos os registros
-- do pai com aquela chave são da MESMA clínica. Pai ambíguo (mesma chave em duas
-- clínicas) ou sem clínica: a filha continua NULL e entra na lista de revisão.
CREATE OR REPLACE FUNCTION pg_temp.m0_preencher(filha TEXT, col_filha TEXT, pai TEXT, col_pai TEXT)
RETURNS VOID AS $$
DECLARE n INT;
BEGIN
  IF to_regclass(format('public.%I', filha)) IS NULL OR to_regclass(format('public.%I', pai)) IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=filha AND column_name=col_filha)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=filha AND column_name='tenant_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=pai AND column_name=col_pai)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=pai AND column_name='tenant_id') THEN
    RETURN;
  END IF;
  EXECUTE format(
    'UPDATE public.%1$I f SET tenant_id = p.tenant_id
       FROM (SELECT %4$I::text AS chave, (array_agg(DISTINCT tenant_id::text))[1]::uuid AS tenant_id
               FROM public.%3$I
              WHERE %4$I IS NOT NULL AND tenant_id IS NOT NULL
              GROUP BY %4$I::text
             HAVING count(DISTINCT tenant_id) = 1) p
      WHERE f.tenant_id IS NULL
        AND f.%2$I IS NOT NULL
        AND p.chave = f.%2$I::text',
    filha, col_filha, pai, col_pai);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE '[M0 preencher] %: % linha(s) com a clínica de %.%', filha, n, pai, col_pai; END IF;
END $$ LANGUAGE plpgsql;

-- Ordem: pais primeiro. Uma regra por linha; a seguinte só pega o que a anterior não resolveu.
-- Paciente
SELECT pg_temp.m0_preencher('prontuarios',             'paciente_id',   'pacientes', 'id');
SELECT pg_temp.m0_preencher('anamneses',               'paciente_id',   'pacientes', 'id');
SELECT pg_temp.m0_preencher('odontogramas',            'paciente_id',   'pacientes', 'id');
SELECT pg_temp.m0_preencher('orcamentos',              'paciente_id',   'pacientes', 'id');
SELECT pg_temp.m0_preencher('tratamentos',             'paciente_id',   'pacientes', 'id');
SELECT pg_temp.m0_preencher('financeiro',              'paciente_id',   'pacientes', 'id');
SELECT pg_temp.m0_preencher('clinical_reports',        'patient_id',    'pacientes', 'id');
SELECT pg_temp.m0_preencher('consultations',           'patient_id',    'pacientes', 'id');
SELECT pg_temp.m0_preencher('consultations',           'appointment_id','agendamentos', 'id');
SELECT pg_temp.m0_preencher('clinical_reports',        'id',            'consultations', 'clinical_report_id');
SELECT pg_temp.m0_preencher('consultations',           'clinical_report_id', 'clinical_reports', 'id');
-- Orçamento → execução → assinatura / catálogo
SELECT pg_temp.m0_preencher('procedimento_execucoes',  'orcamento_id',  'orcamentos', 'id');
SELECT pg_temp.m0_preencher('procedimento_execucoes',  'paciente_id',   'pacientes', 'id');
SELECT pg_temp.m0_preencher('assinaturas_eletronicas', 'id',            'procedimento_execucoes', 'assinatura_id');
SELECT pg_temp.m0_preencher('assinaturas_eletronicas', 'paciente_id',   'pacientes', 'id');
SELECT pg_temp.m0_preencher('procedimentos_catalogo',  'id',            'procedimento_execucoes', 'procedimento_id');
SELECT pg_temp.m0_preencher('procedimentos_catalogo_versoes', 'procedimento_id', 'procedimentos_catalogo', 'id');
-- Tratamento / dentista / estoque
SELECT pg_temp.m0_preencher('tratamento_etapas',       'tratamento_id', 'tratamentos', 'id');
SELECT pg_temp.m0_preencher('comissoes',               'tratamento_id', 'tratamentos', 'id');
SELECT pg_temp.m0_preencher('comissoes',               'dentista_id',   'dentistas', 'id');
SELECT pg_temp.m0_preencher('estoque_movimentos',      'item_id',       'estoque', 'id');
SELECT pg_temp.m0_preencher('estoque',                 'id',            'estoque_movimentos', 'item_id');
-- Lead / atendimento
SELECT pg_temp.m0_preencher('kanban_movements',        'lead_id',       'crm_leads', 'id');
SELECT pg_temp.m0_preencher('lead_tag_assignments',    'lead_id',       'crm_leads', 'id');
SELECT pg_temp.m0_preencher('lead_tags',               'id',            'lead_tag_assignments', 'tag_id');
SELECT pg_temp.m0_preencher('transfer_logs',           'lead_id',       'crm_leads', 'id');
SELECT pg_temp.m0_preencher('transfer_logs',           'from_user_id',  'profiles', 'id');
SELECT pg_temp.m0_preencher('satisfaction_ratings',    'session_id',    'attendance_sessions', 'id');
SELECT pg_temp.m0_preencher('satisfaction_ratings',    'lead_id',       'crm_leads', 'id');
-- Meta Ads
SELECT pg_temp.m0_preencher('meta_ads_campaigns',      'account_id',    'meta_ads_accounts', 'account_id');
SELECT pg_temp.m0_preencher('meta_ads_insights',       'campaign_id',   'meta_ads_campaigns', 'campaign_id');
-- Financeiro (módulos)
SELECT pg_temp.m0_preencher('fin_bills',               'bank_account_id','fin_bank_accounts', 'id');
SELECT pg_temp.m0_preencher('fin_payrolls',            'employee_id',   'fin_employees', 'id');
SELECT pg_temp.m0_preencher('fin_movements',           'bank_account_id','fin_bank_accounts', 'id');
SELECT pg_temp.m0_preencher('fin_movements',           'bill_id',       'fin_bills', 'id');
SELECT pg_temp.m0_preencher('fin_movements',           'payroll_id',    'fin_payrolls', 'id');
-- Por usuário
SELECT pg_temp.m0_preencher('user_preferences',        'user_id',       'profiles', 'id');
SELECT pg_temp.m0_preencher('push_subscriptions',      'user_id',       'profiles', 'id');
SELECT pg_temp.m0_preencher('password_reset_requests', 'user_id',       'profiles', 'id');

-- ─── 4. Lista para revisão ──────────────────────────────────────────────────
-- O que sobrou sem clínica não tem pai identificável. Não atribuir a "primeiro admin":
-- revisar com a clínica (ou, se o banco só tem uma clínica, migration-tenant-defaults.sql
-- já atribui a ela). Detalhe por tabela: docs/banco/diagnostico-rls.sql, seção 6.
DO $$
DECLARE r record; n BIGINT; total INT := 0;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'tenant_id'
       AND table_name = ANY (ARRAY[
         'prontuarios', 'anamneses', 'odontogramas', 'comissoes', 'orcamentos', 'financeiro',
         'tratamentos', 'tratamento_etapas', 'procedimento_execucoes', 'assinaturas_eletronicas',
         'procedimentos_catalogo', 'procedimentos_catalogo_versoes',
         'fin_bank_accounts', 'fin_employees', 'fin_payrolls', 'fin_bills', 'fin_movements', 'fin_overdue',
         'estoque', 'estoque_movimentos', 'contatos', 'lead_tags', 'lead_tag_assignments',
         'kanban_movements', 'transfer_logs', 'satisfaction_ratings', 'clinical_reports', 'consultations',
         'meta_ads_accounts', 'meta_ads_campaigns', 'meta_ads_insights',
         'agenda_marcadores', 'user_preferences', 'push_subscriptions', 'password_reset_requests'])
     ORDER BY table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', r.table_name) INTO n;
    IF n > 0 THEN
      total := total + 1;
      RAISE NOTICE '[M0 revisar] %: % registro(s) sem clínica e sem pai identificável', r.table_name, n;
    END IF;
  END LOOP;
  IF total = 0 THEN RAISE NOTICE '[M0 revisar] nada pendente'; END IF;
END $$;

COMMIT;
