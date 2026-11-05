-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — RLS de verdade (auditoria C1, docs/seguranca/auditoria-backend.md)
-- Autora: Renata (banco) · 2026-11-04 · Plano de virada: docs/banco/plano-virada-rls.md
--
-- Por quê: hoje a RLS não protege. As tabelas estão com NO FORCE e a API conecta
-- como dona delas (PG_USER), então as políticas são ignoradas e toda rota sem
-- "WHERE tenant_id" mostra dados de todas as clínicas.
--
-- O que este arquivo faz (idempotente: pode rodar N vezes; o deploy roda como postgres):
--   1. Funções: get_current_tenant_id(), is_super_admin() e rls_modo_transicao().
--   2. Cria o role de aplicação odonto_app: LOGIN, sem superusuário, sem BYPASSRLS,
--      dono de nada. A senha NÃO fica aqui (é definida à mão pelo Otávio; ver plano).
--   3. Garante tabelas que só o boot do server.mjs criava (o odonto_app não pode criar).
--   4. Adiciona tenant_id (nulo, DEFAULT get_current_tenant_id()) nas tabelas da
--      clínica que não têm. Ex.: procedimento_execucoes, assinaturas_eletronicas.
--   5. Preenche tenant_id NULL só a partir da tabela-pai (paciente, orçamento, lead,
--      usuário...). Nunca usa "primeiro admin" nem "clínica única".
--   6. Cria a política rls_clinica_v1, faz ENABLE e FORCE ROW LEVEL SECURITY em toda
--      tabela que tem tenant_id, e em tenants (por id).
--   7. Libera escrita nas tabelas globais que já tinham RLS só de leitura (plans,
--      system_settings), para não quebrar quando a API deixar de ser dona.
--   8. GRANTs para o odonto_app, incluindo os privilégios padrão para tabelas novas.
--   9. Mostra (NOTICE) quantos registros sem clínica restam por tabela.
--
-- Modos da política (o modo vem de app.rls_modo, configurado no role):
--   transicao (padrão): requisição COM clínica só vê e grava a própria clínica e os
--     registros antigos sem clínica (tenant_id NULL). Sem contexto (login, webhook
--     antes de resolver a clínica, boot) continua como hoje. Super-admin e jobs
--     asSystemJob veem tudo.
--   estrito: só super-admin ou tenant_id = clínica do contexto. Só ligue depois dos
--     pré-requisitos do plano (zero registros sem clínica e rotas sem contexto
--     tratadas no server.mjs):
--       ALTER ROLE odonto_app SET app.rls_modo = 'estrito';   -- e pm2 restart odonto-api
--
-- O que NÃO faz: não troca o PG_USER, não define senha, não põe NOT NULL, não torna
-- por clínica as tabelas globais de hoje (clinica_config, app_settings, ai_settings,
-- system_settings, agenda/overrides Clinicorp: achados A1/A2), não apaga política antiga.
-- As políticas permissivas somam (OR), e rls_clinica_v1 já inclui as antigas.
--
-- ROLLBACK (rodar como postgres; nada de dado é perdido):
--   a) Primeiro volte a API para o usuário antigo: PG_USER=odonto_user no .env e
--      pm2 restart odonto-api --update-env.
--   b) Depois tire o FORCE e a política nova:
--      DO $$ DECLARE r record; BEGIN
--        FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--                 WHERE n.nspname='public' AND c.relkind='r' AND c.relforcerowsecurity LOOP
--          EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.relname);
--        END LOOP;
--        FOR r IN SELECT tablename, policyname FROM pg_policies
--                 WHERE schemaname='public' AND policyname IN ('rls_clinica_v1','rls_global_escrita_v1') LOOP
--          EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
--        END LOOP;
--      END $$;
--   c) Opcional: ALTER ROLE odonto_app NOLOGIN;  (o role pode ficar, não é dono de nada)
--   d) Colunas tenant_id adicionadas e valores preenchidos podem ficar: são opcionais,
--      nulos e a API não depende deles.
--   e) Tire migration-force-rls.sql do deploy.yml, senão o próximo deploy reaplica.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- Não fica na fila atrás de uma consulta longa (o que travaria a API inteira).
-- Se não conseguir o lock em 5 s, falha e desfaz tudo; o próximo deploy tenta de novo.
SET LOCAL lock_timeout = '5s';

-- ─── 1. Funções ──────────────────────────────────────────────────────────────
-- Mesma definição de migration-tenant-defaults.sql ('' vira NULL).
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
  BEGIN
    RETURN NULLIF(current_setting('app.tenant_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql STABLE;

-- Mesma definição de migration-rls-enforcement.sql (o server.mjs seta app.is_super_admin).
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS BOOLEAN AS $$
  DECLARE
    payload TEXT;
  BEGIN
    IF current_setting('app.is_super_admin', true) = 'true' THEN
      RETURN TRUE;
    END IF;
    payload := current_setting('app.jwt_payload', true);
    IF payload IS NOT NULL AND payload <> '' THEN
      RETURN COALESCE((payload::jsonb->>'is_super_admin')::boolean, FALSE);
    END IF;
    RETURN FALSE;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;
$$ LANGUAGE plpgsql STABLE;

-- Transição é o padrão. Só 'estrito' (ALTER ROLE ... SET app.rls_modo) desliga.
-- Padrão permissivo de propósito: se a API voltar para o usuário dono (rollback),
-- ela continua funcionando.
CREATE OR REPLACE FUNCTION rls_modo_transicao() RETURNS BOOLEAN AS $$
  SELECT COALESCE(current_setting('app.rls_modo', true), '') IS DISTINCT FROM 'estrito';
$$ LANGUAGE sql STABLE;

-- ─── 2. Role de aplicação (não dono) ────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
    -- Sem senha: o Otávio define com \password odonto_app (ver plano). Sem senha não loga.
    CREATE ROLE odonto_app LOGIN;
    RAISE NOTICE 'Role odonto_app criado: defina a senha com \password odonto_app';
  END IF;
END $$;

-- Reafirma os atributos a cada execução (se alguém mudou à mão, volta ao seguro).
ALTER ROLE odonto_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;

-- Modo inicial = transicao, gravado no role para este banco. Só grava se ainda não
-- houver valor: não desfaz um 'estrito' já ligado pelo Otávio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_db_role_setting s
      JOIN pg_roles r ON r.oid = s.setrole
     WHERE r.rolname = 'odonto_app'
       AND s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
       AND EXISTS (SELECT 1 FROM unnest(s.setconfig) c WHERE c LIKE 'app.rls_modo=%')
  ) THEN
    EXECUTE format('ALTER ROLE odonto_app IN DATABASE %I SET app.rls_modo = %L', current_database(), 'transicao');
  END IF;
END $$;

-- O role da aplicação não pode herdar privilégios do dono das tabelas.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT g.rolname AS grupo
      FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.roleid
      JOIN pg_roles u ON u.oid = m.member
     WHERE u.rolname = 'odonto_app'
       AND (g.rolsuper OR g.rolbypassrls OR g.rolname IN (SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'))
  LOOP
    EXECUTE format('REVOKE %I FROM odonto_app', r.grupo);
    RAISE WARNING 'odonto_app era membro de % (dono/superusuário): removido', r.grupo;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'odonto_app') THEN
    RAISE WARNING 'odonto_app é dono de tabela em public: a RLS não protege essas tabelas sem FORCE. Revise: SELECT tablename FROM pg_tables WHERE tableowner = ''odonto_app''';
  END IF;
END $$;

-- ─── 3. Tabelas que só o boot criava ─────────────────────────────────────────
-- Depois da virada o boot roda como odonto_app e não consegue mais criar tabela
-- (nem CREATE TABLE IF NOT EXISTS: Postgres 15+ exige CREATE no schema).
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consentimentos_pacientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id(),
  paciente_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  versao TEXT NOT NULL,
  texto TEXT NOT NULL,
  registrado_por UUID,
  registrado_por_email TEXT,
  ip_address TEXT,
  user_agent TEXT,
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revogado_em TIMESTAMPTZ,
  revogado_por UUID
);
CREATE INDEX IF NOT EXISTS idx_consentimentos_pacientes_lookup
  ON consentimentos_pacientes (tenant_id, paciente_id, tipo);

-- ─── 4. tenant_id nas tabelas da clínica que não têm ─────────────────────────
-- Só altera a tabela se precisar (ALTER TABLE trava a tabela mesmo com IF NOT EXISTS).
DO $$
DECLARE
  t TEXT;
  tabelas_da_clinica TEXT[] := ARRAY[
    -- já estavam em migration-rls-enforcement.sql (que não está no deploy.yml)
    'pacientes', 'dentistas', 'agendamentos', 'financeiro', 'tratamentos',
    'orcamentos', 'crm_leads', 'estoque', 'comissoes', 'prontuarios',
    'anamneses', 'attendance_queues', 'attendance_sessions', 'satisfaction_ratings',
    'lead_tags', 'lead_tag_assignments', 'contatos', 'odontogramas',
    'transfer_logs', 'estoque_movimentos', 'tratamento_etapas', 'chat_messages',
    'chat_read_status', 'kanban_movements', 'consultations', 'clinical_reports',
    'push_subscriptions', 'reactivation_rules', 'reactivation_sends',
    'meta_ads_accounts', 'meta_ads_campaigns', 'meta_ads_insights',
    'user_preferences', 'fin_bank_accounts', 'fin_employees', 'fin_payrolls',
    'fin_bills', 'fin_movements', 'fin_overdue',
    -- novas aqui: criadas pelo boot antigo, sem tenant_id
    'procedimento_execucoes', 'assinaturas_eletronicas',
    'procedimentos_catalogo', 'procedimentos_catalogo_versoes', 'agenda_marcadores',
    'automation_flows', 'automation_jobs', 'broadcast_campaigns',
    'clinicorp_user_settings', 'clinicorp_push_log', 'clinicorp_webhook_events',
    'clinicorp_conflicts', 'password_reset_requests',
    'user_roles', 'profiles', 'whatsapp_instances'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas_da_clinica LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE '[tenant_id] % não existe neste banco: ignorada', t;
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id') THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE', t);
      RAISE NOTICE '[tenant_id] coluna criada em %', t;
    END IF;

    -- INSERT sem tenant_id numa requisição autenticada grava a clínica do contexto.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
                  AND data_type = 'uuid' AND column_default IS NULL) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id()', t);
    END IF;

    -- Índice começando por tenant_id (a política e as rotas filtram por ele).
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = format('public.%I', t)::regclass
         AND a.attname = 'tenant_id'
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)', 'idx_' || t || '_tenant_rls', t);
    END IF;
  END LOOP;
END $$;

-- ─── 5. Preenche tenant_id NULL a partir da tabela-pai ───────────────────────
-- Mesma regra da migration-tenant-m0.sql: só mexe em linha com tenant_id NULL e só
-- copia a clínica quando todos os registros do pai com aquela chave são da MESMA
-- clínica. Pai ambíguo ou sem clínica: continua NULL e aparece no relatório do fim
-- (resolver à mão antes do modo estrito). Rollback: não precisa (o valor era NULL).
CREATE OR REPLACE FUNCTION pg_temp.rls_preencher(filha TEXT, col_filha TEXT, pai TEXT, col_pai TEXT, col_tenant_pai TEXT DEFAULT 'tenant_id')
RETURNS VOID AS $$
DECLARE n INT;
BEGIN
  IF to_regclass(format('public.%I', filha)) IS NULL OR to_regclass(format('public.%I', pai)) IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=filha AND column_name=col_filha)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=filha AND column_name='tenant_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=pai AND column_name=col_pai)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=pai AND column_name=col_tenant_pai) THEN
    RETURN;
  END IF;
  EXECUTE format(
    'UPDATE public.%1$I f SET tenant_id = p.tenant_id
       FROM (SELECT %4$I::text AS chave, (array_agg(DISTINCT %5$I::text))[1]::uuid AS tenant_id
               FROM public.%3$I
              WHERE %4$I IS NOT NULL AND %5$I IS NOT NULL
              GROUP BY %4$I::text
             HAVING count(DISTINCT %5$I) = 1) p
      WHERE f.tenant_id IS NULL
        AND f.%2$I IS NOT NULL
        AND p.chave = f.%2$I::text',
    filha, col_filha, pai, col_pai, col_tenant_pai);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE '[preencher] %: % linha(s) com a clínica de %.%', filha, n, pai, col_pai; END IF;
END $$ LANGUAGE plpgsql;

-- Ordem: pais primeiro.
-- Por usuário
SELECT pg_temp.rls_preencher('user_roles',              'user_id',      'profiles', 'id');
SELECT pg_temp.rls_preencher('user_preferences',        'user_id',      'profiles', 'id');
SELECT pg_temp.rls_preencher('push_subscriptions',      'user_id',      'profiles', 'id');
SELECT pg_temp.rls_preencher('clinicorp_user_settings', 'user_id',      'profiles', 'id');
SELECT pg_temp.rls_preencher('password_reset_requests', 'user_id',      'profiles', 'id');
SELECT pg_temp.rls_preencher('chat_read_status',        'user_id',      'profiles', 'id');
SELECT pg_temp.rls_preencher('reactivation_rules',      'created_by',   'profiles', 'id');
SELECT pg_temp.rls_preencher('automation_flows',        'created_by',   'profiles', 'id');
SELECT pg_temp.rls_preencher('broadcast_campaigns',     'created_by',   'profiles', 'id');
-- Por instância do WhatsApp
SELECT pg_temp.rls_preencher('automation_jobs',         'instance',     'whatsapp_instances', 'instance_name');
-- Por paciente
SELECT pg_temp.rls_preencher('anamneses',               'paciente_id',  'pacientes', 'id');
SELECT pg_temp.rls_preencher('odontogramas',            'paciente_id',  'pacientes', 'id');
SELECT pg_temp.rls_preencher('prontuarios',             'paciente_id',  'pacientes', 'id');
SELECT pg_temp.rls_preencher('orcamentos',              'paciente_id',  'pacientes', 'id');
SELECT pg_temp.rls_preencher('tratamentos',             'paciente_id',  'pacientes', 'id');
SELECT pg_temp.rls_preencher('agendamentos',            'paciente_id',  'pacientes', 'id');
SELECT pg_temp.rls_preencher('clinical_reports',        'patient_id',   'pacientes', 'id');
SELECT pg_temp.rls_preencher('consultations',           'patient_id',   'pacientes', 'id');
SELECT pg_temp.rls_preencher('consultations',           'clinical_report_id', 'clinical_reports', 'id');
SELECT pg_temp.rls_preencher('reactivation_sends',      'paciente_id',  'pacientes', 'id');
SELECT pg_temp.rls_preencher('reactivation_sends',      'rule_id',      'reactivation_rules', 'id');
-- Orçamento → execução → assinatura
SELECT pg_temp.rls_preencher('procedimento_execucoes',  'orcamento_id', 'orcamentos', 'id');
SELECT pg_temp.rls_preencher('procedimento_execucoes',  'paciente_id',  'pacientes', 'id');
SELECT pg_temp.rls_preencher('assinaturas_eletronicas', 'paciente_id',  'pacientes', 'id');
SELECT pg_temp.rls_preencher('assinaturas_eletronicas', 'id',           'procedimento_execucoes', 'assinatura_id');
SELECT pg_temp.rls_preencher('procedimentos_catalogo_versoes', 'procedimento_id', 'procedimentos_catalogo', 'id');
-- Tratamento / estoque / dentista
SELECT pg_temp.rls_preencher('tratamento_etapas',       'tratamento_id', 'tratamentos', 'id');
SELECT pg_temp.rls_preencher('comissoes',               'tratamento_id', 'tratamentos', 'id');
SELECT pg_temp.rls_preencher('comissoes',               'dentista_id',   'dentistas', 'id');
SELECT pg_temp.rls_preencher('estoque_movimentos',      'item_id',       'estoque', 'id');
-- Lead / atendimento
SELECT pg_temp.rls_preencher('kanban_movements',        'lead_id',      'crm_leads', 'id');
SELECT pg_temp.rls_preencher('lead_tag_assignments',    'lead_id',      'crm_leads', 'id');
SELECT pg_temp.rls_preencher('transfer_logs',           'lead_id',      'crm_leads', 'id');
SELECT pg_temp.rls_preencher('chat_read_status',        'lead_id',      'crm_leads', 'id');
SELECT pg_temp.rls_preencher('satisfaction_ratings',    'session_id',   'attendance_sessions', 'id');
-- Meta Ads
SELECT pg_temp.rls_preencher('meta_ads_campaigns',      'account_id',   'meta_ads_accounts', 'account_id');
SELECT pg_temp.rls_preencher('meta_ads_insights',       'campaign_id',  'meta_ads_campaigns', 'campaign_id');
-- Financeiro
SELECT pg_temp.rls_preencher('fin_bills',               'bank_account_id', 'fin_bank_accounts', 'id');
SELECT pg_temp.rls_preencher('fin_payrolls',            'employee_id',  'fin_employees', 'id');
SELECT pg_temp.rls_preencher('fin_movements',           'bank_account_id', 'fin_bank_accounts', 'id');
SELECT pg_temp.rls_preencher('fin_movements',           'bill_id',      'fin_bills', 'id');

-- ─── 6. Política + ENABLE + FORCE em toda tabela com tenant_id ───────────────
-- Dinâmico: pega também tabelas que existem só no banco da VPS (ex.: financeiro_despesas).
-- Política versionada: para mudar a regra, crie rls_clinica_v2 e apague a v1.
-- (SELECT f()) faz o Postgres calcular a função uma vez por consulta, não por linha.
DO $$
DECLARE
  r record;
  atual TEXT;
  expr TEXT;
BEGIN
  FOR r IN
    SELECT c.relname AS tabela, col.data_type AS tipo, c.relrowsecurity AS rls, c.relforcerowsecurity AS forcado
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN information_schema.columns col
        ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
     WHERE c.relkind IN ('r', 'p')
     ORDER BY c.relname
  LOOP
    atual := CASE WHEN r.tipo = 'uuid' THEN '(SELECT get_current_tenant_id())'
                  ELSE '(SELECT get_current_tenant_id())::text' END;
    expr := format(
      '(SELECT is_super_admin())
        OR tenant_id = %1$s
        OR ((SELECT rls_modo_transicao()) AND (%1$s IS NULL OR tenant_id IS NULL))', atual);

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tabela AND policyname = 'rls_clinica_v1') THEN
      EXECUTE format('CREATE POLICY rls_clinica_v1 ON public.%I FOR ALL USING (%s) WITH CHECK (%s)', r.tabela, expr, expr);
    END IF;
    IF NOT r.rls THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tabela);
    END IF;
    IF NOT r.forcado THEN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.tabela);
    END IF;
  END LOOP;
END $$;

-- Remove políticas antigas que convertem a configuração direto para uuid, como a
-- tenant_isolation_policy do apply_tenant_rls do boot:
--   tenant_id = current_setting('app.current_tenant_id', true)::uuid
-- Depois que a conexão do pool atende uma requisição com clínica, o valor fica ''
-- (não NULL) e ''::uuid dá ERRO. Hoje não aparece porque a API é dona e a política
-- nem é avaliada. Com o odonto_app, todo job asSystemJob e toda consulta sem contexto
-- nessas tabelas quebraria. A rls_clinica_v1 já permite tudo o que elas permitiam
-- (políticas permissivas somam), então não se perde acesso.
-- Rollback: o boot recria a tenant_isolation_policy quando roda como odonto_user.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname NOT IN ('rls_clinica_v1', 'rls_global_escrita_v1')
       AND (   COALESCE(qual, '')       ~ 'current_setting\(.*\)\)?::uuid'
            OR COALESCE(with_check, '') ~ 'current_setting\(.*\)\)?::uuid')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    RAISE NOTICE '[política antiga] % em % removida (convertia configuração vazia para uuid)', r.policyname, r.tablename;
  END LOOP;
END $$;

-- tenants: a "clínica" é o próprio id. Cadastro de clínica (sem login) cai no modo transição.
DO $$
DECLARE expr TEXT :=
  '(SELECT is_super_admin())
    OR id = (SELECT get_current_tenant_id())
    OR ((SELECT rls_modo_transicao()) AND (SELECT get_current_tenant_id()) IS NULL)';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenants' AND policyname = 'rls_clinica_v1') THEN
    EXECUTE format('CREATE POLICY rls_clinica_v1 ON public.tenants FOR ALL USING (%s) WITH CHECK (%s)', expr, expr);
  END IF;
  ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
END $$;

-- ─── 7. Tabelas globais que já tinham RLS só de leitura ─────────────────────
-- migration-rls-enforcement.sql criou só políticas FOR SELECT em plans e
-- system_settings. Com a API sem ser dona, INSERT/UPDATE nelas passariam a falhar.
-- Escrita em plans: só super-admin (a rota já exige). system_settings: global hoje
-- (pendência de código), mantém o comportamento atual.
DO $$
BEGIN
  IF to_regclass('public.plans') IS NOT NULL
     AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.plans'))
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='plans' AND policyname='rls_global_escrita_v1') THEN
    CREATE POLICY rls_global_escrita_v1 ON public.plans FOR ALL
      USING (true) WITH CHECK ((SELECT is_super_admin()));
  END IF;
  IF to_regclass('public.system_settings') IS NOT NULL
     AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.system_settings'))
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='system_settings' AND policyname='rls_global_escrita_v1') THEN
    CREATE POLICY rls_global_escrita_v1 ON public.system_settings FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── 8. GRANTs do odonto_app ────────────────────────────────────────────────
-- Só DML. Sem CREATE no schema, sem TRUNCATE, sem REFERENCES, sem ser dono.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO odonto_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO odonto_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO odonto_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO odonto_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO odonto_app;

-- Tabelas criadas depois (pelo deploy como postgres, ou por quem for dono hoje)
-- já nascem com o GRANT para o odonto_app.
DO $$
DECLARE dono TEXT;
BEGIN
  FOR dono IN
    SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'odonto_app'
    UNION SELECT 'postgres' WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO odonto_app', dono);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO odonto_app', dono);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO odonto_app', dono);
  END LOOP;
END $$;

-- ─── 9. Relatório: registros sem clínica por tabela ─────────────────────────
-- No modo transição eles continuam visíveis para todas as clínicas (como hoje).
-- Antes do modo estrito precisam ser zero (atribuir à mão, com regra, ou apagar).
DO $$
DECLARE
  r record;
  n BIGINT;
  total INT := 0;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'tenant_id'
       AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
     ORDER BY table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', r.table_name) INTO n;
    IF n > 0 THEN
      total := total + 1;
      RAISE NOTICE '[sem clínica] %: % registro(s) com tenant_id NULL', r.table_name, n;
    END IF;
  END LOOP;
  IF total = 0 THEN
    RAISE NOTICE '[sem clínica] nenhuma tabela com tenant_id NULL: pré-requisito do modo estrito ok';
  END IF;
END $$;

COMMIT;
