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
--   3. Confere que migration-seguranca-p0.sql e migration-tenant-m0.sql já rodaram
--      (elas criam tenant_id, índice e DEFAULT e fazem o preenchimento); se não, aborta.
--   (4 e 5 saíram daqui: colunas, índices e preenchimento ficam no P0 e no M0, sem duplicar.)
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

-- ─── 3. Pré-condição: P0 e M0 já rodaram ────────────────────────────────────
-- As colunas tenant_id e o preenchimento vêm de migration-seguranca-p0.sql (P0) e
-- migration-tenant-m0.sql (M0), que rodam no deploy antes deste arquivo. Se faltar
-- tenant_id numa tabela da clínica que existe, a tabela ficaria sem RLS sem ninguém
-- perceber: aborta e desfaz tudo.
DO $$
DECLARE faltando TEXT;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t) INTO faltando
    FROM unnest(ARRAY[
      -- P0
      'anamneses', 'odontogramas', 'estoque_movimentos', 'tratamento_etapas', 'comissoes',
      'prontuarios', 'lead_tags', 'lead_tag_assignments', 'transfer_logs', 'satisfaction_ratings',
      'consultations', 'clinical_reports', 'fin_employees', 'fin_bills', 'fin_overdue',
      'fin_bank_accounts', 'fin_movements', 'fin_payrolls', 'agenda_marcadores',
      'procedimentos_catalogo', 'contatos', 'dentistas', 'estoque', 'tratamentos',
      'orcamentos', 'financeiro', 'procedimento_execucoes', 'assinaturas_eletronicas',
      'meta_ads_accounts', 'meta_ads_campaigns', 'meta_ads_insights', 'clinica_config',
      -- M0
      'procedimentos_catalogo_versoes', 'kanban_movements', 'user_preferences', 'push_subscriptions',
      'password_reset_requests', 'user_roles', 'reactivation_rules', 'reactivation_sends',
      'chat_read_status', 'attendance_queues', 'whatsapp_instances', 'automation_flows',
      'automation_jobs', 'broadcast_campaigns', 'clinicorp_user_settings', 'clinicorp_push_log',
      'clinicorp_webhook_events', 'clinicorp_conflicts', 'tenant_settings', 'consentimentos_pacientes', 'whatsapp_marketing_consents',
      -- já existentes
      'pacientes', 'agendamentos', 'crm_leads', 'chat_messages', 'attendance_sessions', 'profiles'
    ]) AS t
   WHERE to_regclass(format('public.%I', t)) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id');
  IF to_regclass('public.tenant_settings') IS NULL THEN
    faltando := concat_ws(', ', faltando, 'tenant_settings (tabela)');
  END IF;
  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Rode migration-seguranca-p0.sql e migration-tenant-m0.sql antes. Sem tenant_id: %', faltando;
  END IF;
END $$;

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
