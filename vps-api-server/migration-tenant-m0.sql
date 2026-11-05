-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — M0: complemento de tenant_id (junto com migration-seguranca-p0.sql)
-- Autora: Renata (banco) · 2026-11-05 · Ensaio: docs/banco/ensaio-migracoes.md
--
-- Divisão de trabalho, sem duplicar coluna nem regra:
--   migration-seguranca-p0.sql (P0): tenant_id + índice + DEFAULT + preenchimento nas
--     32 tabelas que as rotas novas filtram; clinica_config por clínica; tenant_ai_settings;
--     chaves únicas do Meta Ads.
--   ESTE ARQUIVO (M0): o que o P0 não cobre —
--     1. tenant_settings (configuração por clínica, substitui app_settings),
--        whatsapp_marketing_consents (consentimento de marketing, com histórico) e as tabelas que
--        só o boot criava (password_reset_requests, consentimentos_pacientes);
--     2. tenant_id nas tabelas da clínica fora da lista do P0 (kanban, preferências, push,
--        pedidos de senha, versões do catálogo, reativação, Clinicorp...);
--     3. índice e DEFAULT get_current_tenant_id() em TODA tabela que já tem tenant_id;
--     4. regras de preenchimento pelo pai que o P0 não tem;
--     5. CORREÇÃO DO LEGADO: a migration-saas.sql (no deploy) põe em todo deploy os NULL
--        de pacientes/dentistas/agendamentos/financeiro/tratamentos (e profiles) na
--        clínica placeholder 00000000-…-0001. O server.mjs trata esse id como inválido, então
--        esses registros somem para a clínica dona. A correção (filha volta para a clínica
--        do pai quando o pai é de UMA clínica real) fica em migration-tenant-m0-legado.sql,
--        rodada À MÃO pelo Otávio depois do dry-run — não neste arquivo;
--     6. lista o que ficou sem clínica ou no Legado, para revisão.
--
-- Idempotente. Roda no deploy depois do P0 e de migration-whatsapp-fase1.sql. Também roda
-- sozinho: regra cuja tabela ou coluna ainda não existe é pulada.
-- O item 5 (Legado → clínica real) NÃO roda aqui: está em migration-tenant-m0-legado.sql,
-- script MANUAL com dry-run (troca de dono de dado de saúde entre clínicas não é automática).
-- NÃO faz: RLS/FORCE/políticas (migration-force-rls.sql), NOT NULL, DROP.
--
-- Transações (para não segurar lock de dezenas de tabelas com a API no ar):
--   A. itens 1 e 2 numa transação curta (CREATE TABLE IF NOT EXISTS e ADD COLUMN sem DEFAULT
--      são só catálogo);
--   B. item 3 com COMMIT a cada tabela (o CREATE INDEX trava escrita só daquela tabela);
--   C. item 4: cada regra é uma transação (auditoria + UPDATE juntos).
--   lock_timeout de 5 s em tudo: sem o lock, o comando falha, o que já foi confirmado fica,
--   o resto não roda, o deploy mostra o alerta e o próximo deploy continua de onde parou.
--
-- Auditoria: toda linha cujo tenant_id o item 4 altera vai antes para
-- migracao.tenant_m0_auditoria (tabela, pk, tenant_antigo, tenant_novo, em), na mesma
-- transação do UPDATE. Schema separado: o odonto_app não recebe acesso (a FORCE só dá GRANT
-- no public).
--
-- Rollback: colunas, índices e DEFAULT são opcionais e podem ficar. Para desfazer de vez:
--   ALTER TABLE <tabela> DROP COLUMN IF EXISTS tenant_id;   -- só onde o M0 criou a coluna
--   DROP TABLE IF EXISTS tenant_settings;                    -- perde a configuração por clínica
--   Preenchimentos (item 4): docs/banco/rollback-tenant-m0.sql (dry-run por padrão; volta cada
--   linha ao tenant_antigo registrado, só se ninguém a mudou depois).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- Vale para todas as transações desta sessão.
SET lock_timeout = '5s';

-- ═══ A. Itens 1 e 2 (transação curta) ══════════════════════════════════════
BEGIN;

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

-- Consentimento de marketing no WhatsApp (parecer jurídico A1; fila em processOneWhatsAppJob).
-- Por telefone, como whatsapp_opt_outs: marketing também vai para lead que não é paciente.
-- phone_key = waPhoneKey() do server.mjs (a mesma chave do opt-out).
-- HISTÓRICO, não uma linha por telefone: cada aceite é uma linha; revogar preenche
-- revogado_em (nunca apagar — LGPD art. 8º §2º, ônus da prova do aceite, e §5º, revogação).
-- Só uma linha ATIVA por clínica + telefone (índice único parcial abaixo).
-- Regra para a fila: envio de marketing só com linha ativa E sem opt-out em whatsapp_opt_outs
-- (opt-out sempre vence; ao registrar opt-out, revogar a linha ativa com origem_revogacao='opt_out').
CREATE TABLE IF NOT EXISTS whatsapp_marketing_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  phone_key TEXT NOT NULL CHECK (phone_key ~ '^[0-9]{8,}$'),
  paciente_id TEXT,
  lead_id TEXT,
  base_legal TEXT NOT NULL CHECK (base_legal IN ('consentimento', 'legitimo_interesse')),
  origem TEXT NOT NULL,              -- ex.: 'recepcao', 'formulario', 'whatsapp_resposta', 'importacao'
  texto TEXT,                        -- texto exato mostrado/lido ao titular
  versao TEXT,
  registrado_por UUID,
  ip_address TEXT,
  user_agent TEXT,
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revogado_em TIMESTAMPTZ,
  revogado_por UUID,
  origem_revogacao TEXT,             -- ex.: 'opt_out', 'pedido_titular', 'clinica'
  CHECK (revogado_em IS NULL OR revogado_em >= aceito_em)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_marketing_consents_ativo
  ON whatsapp_marketing_consents (tenant_id, phone_key) WHERE revogado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_marketing_consents_historico
  ON whatsapp_marketing_consents (tenant_id, phone_key, aceito_em DESC);

-- O deploy roda como postgres. Tabela criada aqui passa para o dono das tabelas da API
-- (dono de pacientes), para a API atual ter o mesmo acesso que teria se o boot a criasse.
DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_settings', 'password_reset_requests', 'consentimentos_pacientes', 'whatsapp_marketing_consents'] LOOP
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

-- Auditoria das trocas de tenant_id (itens 4 e 5). Fora do public: a API não lê nem grava.
CREATE SCHEMA IF NOT EXISTS migracao AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA migracao FROM PUBLIC;
CREATE TABLE IF NOT EXISTS migracao.tenant_m0_auditoria (
  id BIGSERIAL PRIMARY KEY,
  lote BIGINT NOT NULL,               -- txid da transação que trocou
  regra TEXT NOT NULL,                -- 'preencher' (item 4) ou 'legado' (item 5) + pai.coluna
  tabela TEXT NOT NULL,
  pk TEXT NOT NULL,                   -- chave primária da linha, como texto
  tenant_antigo UUID,                 -- NULL (item 4) ou o placeholder Legado (item 5)
  tenant_novo UUID NOT NULL,
  em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  desfeito_em TIMESTAMPTZ             -- preenchido pelo docs/banco/rollback-tenant-m0.sql
);
CREATE INDEX IF NOT EXISTS idx_tenant_m0_auditoria_lote ON migracao.tenant_m0_auditoria (lote, tabela);
CREATE INDEX IF NOT EXISTS idx_tenant_m0_auditoria_linha ON migracao.tenant_m0_auditoria (tabela, pk);

COMMIT;

-- ═══ B. Item 3 (COMMIT a cada tabela) ══════════════════════════════════════
-- ─── 3. Índice e DEFAULT em toda tabela com tenant_id ───────────────────────
-- Inclui as do P0 e as antigas: só cria o que falta (índice que comece por tenant_id;
-- DEFAULT só em coluna uuid sem DEFAULT). Tabela que já tem os dois não é tocada.
-- Catálogo direto (pg_attribute.atthasdef), sem information_schema: ler column_default
-- deparseia o DEFAULT e pede lock em toda tabela, até nas que não precisam de nada.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname, format_type(a.atttypid, a.atttypmod) AS data_type, a.atthasdef
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = r.oid AND a.attname = 'tenant_id'
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)', left('idx_' || r.relname || '_tenant', 63), r.relname);
    END IF;
    IF r.data_type = 'uuid' AND NOT r.atthasdef THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id()', r.relname);
    END IF;
    COMMIT;  -- solta o lock desta tabela antes da próxima
  END LOOP;
END $$;

-- ─── Função de preenchimento pelo pai (itens 4 e 5) ─────────────────────────
-- Copia a clínica do pai para a filha só quando todos os registros do pai com aquela chave
-- são da MESMA clínica real (pai no Legado não conta como clínica). Por padrão só mexe em
-- filha com tenant_id NULL; com corrige_legado = true, só na filha que está no Legado.
-- aplicar = false: só conta (dry-run, sem lock de linha). filtro: condição SQL extra sobre f.
-- Cada troca é gravada em migracao.tenant_m0_auditoria ANTES do UPDATE, na mesma transação;
-- o UPDATE só muda as linhas auditadas naquele lote. Filha sem chave primária de uma coluna
-- é pulada (não daria para desfazer).
-- (Mesma função em migration-tenant-m0.sql e migration-tenant-m0-legado.sql.)
CREATE OR REPLACE FUNCTION pg_temp.m0_preencher(filha TEXT, col_filha TEXT, pai TEXT, col_pai TEXT,
  corrige_legado BOOLEAN DEFAULT false, aplicar BOOLEAN DEFAULT true, filtro TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  n BIGINT;
  legado CONSTANT TEXT := '00000000-0000-0000-0000-000000000001';
  regra TEXT := CASE WHEN corrige_legado THEN 'legado' ELSE 'preencher' END || ':' || pai || '.' || col_pai;
  pk_col TEXT;
  pk_tipo TEXT;
  origem TEXT;
BEGIN
  IF to_regclass(format('public.%I', filha)) IS NULL OR to_regclass(format('public.%I', pai)) IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=filha AND column_name=col_filha)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=filha AND column_name='tenant_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=pai AND column_name=col_pai)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=pai AND column_name='tenant_id') THEN
    RETURN;
  END IF;
  SELECT min(a.attname), min(format_type(a.atttypid, a.atttypmod))
    INTO pk_col, pk_tipo
    FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid = format('public.%I', filha)::regclass AND i.indisprimary
  HAVING count(*) = 1;
  IF pk_col IS NULL THEN
    RAISE NOTICE '[M0 %] %: sem chave primária de uma coluna, pulada', regra, filha;
    RETURN;
  END IF;

  -- Linhas candidatas: f = filha, p = clínica única (real) do pai.
  origem := format(
    'FROM public.%1$I f
       JOIN (SELECT %4$I::text AS chave, (array_agg(DISTINCT tenant_id::text))[1]::uuid AS tenant_id
               FROM public.%3$I
              WHERE %4$I IS NOT NULL AND tenant_id IS NOT NULL
              GROUP BY %4$I::text
             HAVING count(DISTINCT tenant_id) = 1
                AND (array_agg(DISTINCT tenant_id::text))[1] <> %5$L) p
         ON p.chave = f.%2$I::text
      WHERE %6$s
        AND f.%2$I IS NOT NULL
        AND (%7$s)',
    filha, col_filha, pai, col_pai, legado,
    CASE WHEN corrige_legado THEN format('f.tenant_id::text = %L', legado) ELSE 'f.tenant_id IS NULL' END,
    COALESCE(filtro, 'true'));

  IF NOT aplicar THEN
    EXECUTE 'SELECT count(*) ' || origem INTO n;
    IF n > 0 THEN
      RAISE NOTICE '[M0 dry-run %] %: % linha(s) iriam para a clínica de %.%', regra, filha, n, pai, col_pai;
    END IF;
    RETURN;
  END IF;

  EXECUTE format(
    'INSERT INTO migracao.tenant_m0_auditoria (lote, regra, tabela, pk, tenant_antigo, tenant_novo)
     SELECT txid_current(), %1$L, %2$L, f.%3$I::text, f.tenant_id, p.tenant_id %4$s
        FOR UPDATE OF f', regra, filha, pk_col, origem);
  EXECUTE format(
    'UPDATE public.%1$I f SET tenant_id = a.tenant_novo
       FROM migracao.tenant_m0_auditoria a
      WHERE a.lote = txid_current() AND a.tabela = %2$L AND a.regra = %3$L
        AND f.%4$I = a.pk::%5$s',
    filha, filha, regra, pk_col, pk_tipo);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '[M0 %] %: % linha(s) com a clínica de %.% (auditadas, lote %)',
      regra, filha, n, pai, col_pai, txid_current();
  END IF;
END $$ LANGUAGE plpgsql;

-- ═══ C. Item 4 (cada SELECT é uma transação: auditoria + UPDATE) ═══════════
-- Item 5 (Legado → clínica real): migration-tenant-m0-legado.sql (manual, dry-run por padrão).
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
-- Sem clínica: não tem pai identificável. No Legado: a migration-saas.sql pôs lá; o que tem
-- pai de clínica real sai com migration-tenant-m0-legado.sql (manual), o resto (ex.: paciente
-- que nunca teve clínica) é revisado com a clínica dona; nunca atribuir a "primeiro admin".
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
