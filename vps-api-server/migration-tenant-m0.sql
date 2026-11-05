-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — M0: complemento de tenant_id (junto com migration-seguranca-p0.sql)
-- Autora: Renata (banco) · 2026-11-05 · Ensaio: docs/banco/ensaio-migracoes.md
--
-- Divisão de trabalho, sem duplicar coluna nem regra:
--   migration-seguranca-p0.sql (P0): tenant_id + índice + DEFAULT + preenchimento nas
--     32 tabelas que as rotas novas filtram; clinica_config por clínica; tenant_ai_settings;
--     chaves únicas do Meta Ads.
--   ESTE ARQUIVO (M0): o que o P0 não cobre —
--     1. tenant_settings (configuração por clínica, substitui app_settings) e as tabelas que
--        só o boot criava (password_reset_requests, consentimentos_pacientes);
--     2. tenant_id nas tabelas da clínica fora da lista do P0 (kanban, preferências, push,
--        pedidos de senha, versões do catálogo, reativação, Clinicorp...);
--     3. índice e DEFAULT get_current_tenant_id() em TODA tabela que já tem tenant_id;
--     4. regras de preenchimento pelo pai que o P0 não tem;
--     5. CORREÇÃO DO LEGADO: a migration-saas.sql (no deploy) põe em todo deploy os NULL
--        de pacientes/dentistas/agendamentos/financeiro/tratamentos (e profiles) na
--        clínica placeholder 00000000-…-0001. O server.mjs trata esse id como inválido, então
--        esses registros somem para a clínica dona. Aqui a filha volta para a clínica
--        do pai quando o pai é de UMA clínica real (diferente do Legado);
--     6. lista o que ficou sem clínica ou no Legado, para revisão.
--
-- Idempotente e só aditivo, a não ser pelo item 5 (que só troca o placeholder pela clínica
-- do pai). Roda no deploy depois do P0 e de migration-whatsapp-fase1.sql. Também roda sozinho:
-- regra cujas tabela ou coluna ainda não existem é pulada.
-- NÃO faz: RLS/FORCE/políticas (migration-force-rls.sql), NOT NULL, DROP.
--
-- Rollback: colunas, índices e DEFAULT são opcionais e podem ficar. Para desfazer de vez:
--   ALTER TABLE <tabela> DROP COLUMN IF EXISTS tenant_id;   -- só onde o M0 criou a coluna
--   DROP TABLE IF EXISTS tenant_settings;                    -- perde a configuração por clínica
--   O item 5 não tem desfazer automático: guarde antes a saída da seção 6 do
--   docs/banco/diagnostico-rls.sql (e o NOTICE "[M0 legado]" informa cada troca).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- Se não conseguir o lock em 5 s, desfaz tudo e o próximo deploy tenta de novo.
SET LOCAL lock_timeout = '5s';

-- Mesma definição de migration-tenant-defaults.sql ('' vira NULL).
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
  BEGIN
    RETURN NULLIF(current_setting('app.tenant_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql STABLE;

-- ─── 1. Tabelas novas ───────────────────────────────────────────────────────
-- Configuração por clínica (attendance_settings, solution_hours, followup...).
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key)
);

-- A rota forgot-password criava esta tabela sozinha; o role não dono não pode.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Só o boot criava (server.mjs). Mesma definição.
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

-- O deploy roda como postgres. Tabela criada aqui passa para o dono das tabelas da API
-- (dono de pacientes), para a API atual ter o mesmo acesso que teria se o boot a criasse.
DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_settings', 'password_reset_requests', 'consentimentos_pacientes'] LOOP
    IF dono IS NOT NULL AND dono <> 'postgres'
       AND (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = t) = 'postgres' THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, dono);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO odonto_app', t);
    END IF;
  END LOOP;
END $$;

-- ─── 2. tenant_id nas tabelas fora da lista do P0 ───────────────────────────
-- Só altera a tabela se precisar (ALTER TABLE trava a tabela mesmo com IF NOT EXISTS).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'procedimentos_catalogo_versoes', 'kanban_movements', 'user_preferences', 'push_subscriptions',
    'password_reset_requests', 'user_roles', 'reactivation_rules', 'reactivation_sends',
    'chat_read_status', 'attendance_queues', 'whatsapp_instances',
    'automation_flows', 'automation_jobs', 'broadcast_campaigns',
    'clinicorp_user_settings', 'clinicorp_push_log', 'clinicorp_webhook_events', 'clinicorp_conflicts'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id') THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE', t);
      RAISE NOTICE '[M0] coluna tenant_id criada em %', t;
    END IF;
  END LOOP;
END $$;

-- ─── 3. Índice e DEFAULT em toda tabela com tenant_id ───────────────────────
-- Inclui as do P0 e as antigas: só cria o que falta (índice que comece por tenant_id;
-- DEFAULT só em coluna uuid sem DEFAULT).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname, col.data_type, col.column_default
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN information_schema.columns col
        ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
     WHERE c.relkind = 'r'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = r.oid AND a.attname = 'tenant_id'
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)', left('idx_' || r.relname || '_tenant', 63), r.relname);
    END IF;
    IF r.data_type = 'uuid' AND r.column_default IS NULL THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id()', r.relname);
    END IF;
  END LOOP;
END $$;

-- ─── 4 e 5. Preenchimento pelo pai (e correção do Legado) ───────────────────
-- Copia a clínica do pai para a filha só quando todos os registros do pai com aquela chave
-- são da MESMA clínica real (pai no Legado não conta como clínica). Por padrão só mexe em
-- filha com tenant_id NULL. Com corrige_legado = true, também na filha que está no Legado.
CREATE OR REPLACE FUNCTION pg_temp.m0_preencher(filha TEXT, col_filha TEXT, pai TEXT, col_pai TEXT, corrige_legado BOOLEAN DEFAULT false)
RETURNS VOID AS $$
DECLARE
  n INT;
  legado CONSTANT TEXT := '00000000-0000-0000-0000-000000000001';
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
             HAVING count(DISTINCT tenant_id) = 1
                AND (array_agg(DISTINCT tenant_id::text))[1] <> %5$L) p
      WHERE (f.tenant_id IS NULL OR (%6$L AND f.tenant_id::text = %5$L))
        AND f.%2$I IS NOT NULL
        AND p.chave = f.%2$I::text',
    filha, col_filha, pai, col_pai, legado, corrige_legado);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '[M0 %] %: % linha(s) com a clínica de %.%',
      CASE WHEN corrige_legado THEN 'legado' ELSE 'preencher' END, filha, n, pai, col_pai;
  END IF;
END $$ LANGUAGE plpgsql;

-- 5. Correção do Legado (pais primeiro). Pacientes no Legado sem pai continuam lá (revisão).
SELECT pg_temp.m0_preencher('agendamentos',           'paciente_id',   'pacientes',    'id', true);
SELECT pg_temp.m0_preencher('financeiro',             'paciente_id',   'pacientes',    'id', true);
SELECT pg_temp.m0_preencher('tratamentos',            'paciente_id',   'pacientes',    'id', true);
SELECT pg_temp.m0_preencher('dentistas',              'id',            'agendamentos', 'dentista_id', true);
SELECT pg_temp.m0_preencher('tratamento_etapas',      'tratamento_id', 'tratamentos',  'id', true);
SELECT pg_temp.m0_preencher('comissoes',              'tratamento_id', 'tratamentos',  'id', true);
SELECT pg_temp.m0_preencher('procedimento_execucoes', 'paciente_id',   'pacientes',    'id', true);
SELECT pg_temp.m0_preencher('prontuarios',            'paciente_id',   'pacientes',    'id', true);
SELECT pg_temp.m0_preencher('anamneses',              'paciente_id',   'pacientes',    'id', true);
SELECT pg_temp.m0_preencher('odontogramas',           'paciente_id',   'pacientes',    'id', true);
SELECT pg_temp.m0_preencher('orcamentos',             'paciente_id',   'pacientes',    'id', true);
SELECT pg_temp.m0_preencher('user_roles',             'user_id',       'profiles',     'id', true);

-- 4. Regras que o P0 não tem (só NULL).
-- Por usuário
SELECT pg_temp.m0_preencher('user_roles',              'user_id',      'profiles', 'id');
SELECT pg_temp.m0_preencher('user_preferences',        'user_id',      'profiles', 'id');
SELECT pg_temp.m0_preencher('push_subscriptions',      'user_id',      'profiles', 'id');
SELECT pg_temp.m0_preencher('password_reset_requests', 'user_id',      'profiles', 'id');
SELECT pg_temp.m0_preencher('clinicorp_user_settings', 'user_id',      'profiles', 'id');
SELECT pg_temp.m0_preencher('chat_read_status',        'user_id',      'profiles', 'id');
SELECT pg_temp.m0_preencher('reactivation_rules',      'created_by',   'profiles', 'id');
SELECT pg_temp.m0_preencher('transfer_logs',           'from_user_id', 'profiles', 'id');
-- Lead
SELECT pg_temp.m0_preencher('kanban_movements',        'lead_id',      'crm_leads', 'id');
SELECT pg_temp.m0_preencher('chat_read_status',        'lead_id',      'crm_leads', 'id');
-- Consulta / relatório / agendamento
SELECT pg_temp.m0_preencher('consultations',           'appointment_id',     'agendamentos',     'id');
SELECT pg_temp.m0_preencher('consultations',           'clinical_report_id', 'clinical_reports', 'id');
SELECT pg_temp.m0_preencher('clinical_reports',        'id',                 'consultations',    'clinical_report_id');
-- Catálogo (pelo uso nas execuções, só se usado por uma clínica) e versões
SELECT pg_temp.m0_preencher('procedimentos_catalogo',  'id',              'procedimento_execucoes', 'procedimento_id');
SELECT pg_temp.m0_preencher('procedimentos_catalogo_versoes', 'procedimento_id', 'procedimentos_catalogo', 'id');
-- Estoque pelo movimento
SELECT pg_temp.m0_preencher('estoque',                 'id',           'estoque_movimentos', 'item_id');
-- Reativação
SELECT pg_temp.m0_preencher('reactivation_sends',      'rule_id',      'reactivation_rules', 'id');
SELECT pg_temp.m0_preencher('reactivation_sends',      'paciente_id',  'pacientes',          'id');
-- Meta Ads e financeiro (P0 só usa "clínica única" nestes)
SELECT pg_temp.m0_preencher('meta_ads_campaigns',      'account_id',   'meta_ads_accounts',  'account_id');
SELECT pg_temp.m0_preencher('meta_ads_insights',       'campaign_id',  'meta_ads_campaigns', 'campaign_id');
SELECT pg_temp.m0_preencher('fin_bills',               'bank_account_id', 'fin_bank_accounts', 'id');
SELECT pg_temp.m0_preencher('fin_movements',           'bill_id',      'fin_bills',          'id');

-- ─── 6. Lista para revisão ──────────────────────────────────────────────────
-- Sem clínica: não tem pai identificável. No Legado: a migration-saas.sql pôs lá e não há
-- pai para corrigir (ex.: paciente que nunca teve clínica). Revisar com a clínica dona;
-- nunca atribuir a "primeiro admin".
DO $$
DECLARE r record; nulo BIGINT; leg BIGINT; total INT := 0;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'tenant_id'
       AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
     ORDER BY table_name
  LOOP
    EXECUTE format('SELECT count(*) FILTER (WHERE tenant_id IS NULL),
                           count(*) FILTER (WHERE tenant_id::text = %L)
                      FROM public.%I', '00000000-0000-0000-0000-000000000001', r.table_name) INTO nulo, leg;
    IF nulo > 0 OR leg > 0 THEN
      total := total + 1;
      RAISE NOTICE '[M0 revisar] %: % sem clínica, % no Legado', r.table_name, nulo, leg;
    END IF;
  END LOOP;
  IF total = 0 THEN RAISE NOTICE '[M0 revisar] nada pendente'; END IF;
END $$;

COMMIT;
