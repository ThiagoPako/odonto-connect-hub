-- Schema B2/B3 (achados do QA, 2026-11-05) — colunas e tabelas que o server.mjs usa e que
-- nenhuma migração do deploy nem o boot criam. Num banco que não tenha recebido as migrações
-- avulsas (rodadas à mão), estas rotas dão 500:
--   B2  orcamentos: POST/PUT /api/orcamentos (server.mjs ~7404-7466) gravam itens, valor_total,
--       desconto, validade, observacoes, forma_pagamento, parcelas, titulo, print_config,
--       odontograma_snapshot. O boot cria orcamentos só com id/tenant/paciente/dentista/valor/
--       status/data; observacoes/forma_pagamento/parcelas estão só na migration-full-audit.sql
--       (fora do deploy); titulo/print_config/odontograma_snapshot em lugar nenhum.
--   B2  procedimentos_catalogo + procedimentos_catalogo_versoes: tela Procedimentos e o
--       congelamento de versão no orçamento (congelarVersoesItens, criarVersaoProcedimento,
--       GET /api/procedimentos-catalogo/:id/versoes e /versao-em). Nenhum .sql cria as tabelas.
--       A tabela de versões não tinha tenant_id: ganha a coluna, preenchida por trigger a partir
--       do procedimento (o INSERT do código não manda tenant_id).
--   B3  reactivation_rules/sends.tenant_id: GET /api/reativacao/rules (~8540) filtra
--       r.tenant_id. A coluna vem da migration-schema-alinhamento.sql, mas sem DEFAULT (ela roda
--       depois da migration-tenant-defaults.sql) e sem preencher linhas antigas. POST
--       /api/reativacao/rules/:id/send (~8750) grava o envio "falhou" sem tenant_id, e o KPI
--       (WHERE tenant_id = $1) não o conta. As tabelas foram criadas pelo deploy (dono postgres):
--       com RLS ligada, o hook da fila (sem contexto de clínica) não consegue gravar o envio.
--
-- SÓ DE DEPLOY (deploy.yml, como postgres): tem blocos DO, o boot (split em ";\s*\n") quebraria.
-- Idempotente: só IF NOT EXISTS / CREATE OR REPLACE / DO com checagem. Nada é apagado; os
-- backfills só preenchem tenant_id NULL a partir de uma linha-mãe (procedimento, regra, autor).
-- Rollback: as colunas são anuláveis e podem ficar. Para desfazer as peças novas:
--   DROP TRIGGER IF EXISTS trg_proc_versoes_tenant ON procedimentos_catalogo_versoes;
--   DROP TRIGGER IF EXISTS trg_reactivation_sends_tenant ON reactivation_sends;
--   DROP FUNCTION IF EXISTS b2b3_proc_versoes_tenant(), b2b3_reactivation_sends_tenant();
--   ALTER TABLE reactivation_rules OWNER TO postgres; ALTER TABLE reactivation_sends OWNER TO postgres;
--   (DROP TABLE procedimentos_catalogo_versoes perde o histórico de preços — não fazer.)
\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

-- Quais tabelas já existiam antes deste arquivo (só as criadas AGORA mudam de dono/ganham RLS).
CREATE TEMP TABLE b2b3_ja_existiam ON COMMIT DROP AS
  SELECT t AS nome FROM unnest(ARRAY['procedimentos_catalogo', 'procedimentos_catalogo_versoes']) t
   WHERE to_regclass('public.' || t) IS NOT NULL;

-- ─── B2: orcamentos ───────────────────────────────────────────────────────
-- tenant_id: a migration-saas.sql já cria; repetido aqui porque todas as rotas filtram por ele.
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS itens JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS valor_total NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS desconto NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS validade TIMESTAMPTZ;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS parcelas INTEGER DEFAULT 1;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS titulo TEXT;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS print_config JSONB;
ALTER TABLE IF EXISTS orcamentos ADD COLUMN IF NOT EXISTS odontograma_snapshot JSONB;
-- GET /api/orcamentos: WHERE o.tenant_id = $1 ORDER BY o.created_at DESC
CREATE INDEX IF NOT EXISTS idx_orcamentos_tenant_created ON orcamentos (tenant_id, created_at DESC);

-- ─── B2: procedimentos_catalogo ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS procedimentos_catalogo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT,
  nome TEXT NOT NULL,
  categoria TEXT,
  valor_particular NUMERIC(12,2) DEFAULT 0,
  valor_convenio NUMERIC(12,2) DEFAULT 0,
  duracao_minutos INTEGER DEFAULT 30,
  cor TEXT DEFAULT '#0d9488',
  requer_dente BOOLEAN DEFAULT true,
  requer_face BOOLEAN DEFAULT false,
  descricao TEXT,
  ativo BOOLEAN DEFAULT true,
  versao_atual INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Tabela antiga (criada fora do repositório): completa só o que faltar.
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS codigo TEXT;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS valor_particular NUMERIC(12,2) DEFAULT 0;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS valor_convenio NUMERIC(12,2) DEFAULT 0;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS duracao_minutos INTEGER DEFAULT 30;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS cor TEXT DEFAULT '#0d9488';
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS requer_dente BOOLEAN DEFAULT true;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS requer_face BOOLEAN DEFAULT false;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS descricao TEXT;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS versao_atual INTEGER DEFAULT 1;
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE procedimentos_catalogo ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE procedimentos_catalogo ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id();
CREATE INDEX IF NOT EXISTS idx_procedimentos_catalogo_tenant ON procedimentos_catalogo (tenant_id);

-- ─── B2: procedimentos_catalogo_versoes ───────────────────────────────────
-- procedimento_id com o MESMO tipo de procedimentos_catalogo.id (o JOIN do código compara os dois).
DO $$
DECLARE
  tipo_id TEXT := (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
                    WHERE a.attrelid = 'public.procedimentos_catalogo'::regclass
                      AND a.attname = 'id' AND NOT a.attisdropped);
BEGIN
  IF to_regclass('public.procedimentos_catalogo_versoes') IS NULL THEN
    EXECUTE format($f$
      CREATE TABLE public.procedimentos_catalogo_versoes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        procedimento_id %s NOT NULL REFERENCES procedimentos_catalogo(id) ON DELETE CASCADE,
        versao INTEGER NOT NULL,
        codigo TEXT,
        nome TEXT NOT NULL,
        categoria TEXT,
        valor_particular NUMERIC(12,2) DEFAULT 0,
        valor_convenio NUMERIC(12,2) DEFAULT 0,
        duracao_minutos INTEGER,
        cor TEXT,
        requer_dente BOOLEAN DEFAULT true,
        requer_face BOOLEAN DEFAULT false,
        descricao TEXT,
        motivo TEXT,
        alterado_por UUID,
        valido_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        valido_ate TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )$f$, tipo_id);
  END IF;
END $$;
-- Tabela antiga: completa o que faltar (anulável; nada de NOT NULL em coluna existente).
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS versao INTEGER;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS codigo TEXT;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS nome TEXT;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS valor_particular NUMERIC(12,2);
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS valor_convenio NUMERIC(12,2);
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS duracao_minutos INTEGER;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS cor TEXT;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS requer_dente BOOLEAN;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS requer_face BOOLEAN;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS descricao TEXT;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS motivo TEXT;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS alterado_por UUID;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS valido_desde TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS valido_ate TIMESTAMPTZ;
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_proc_versoes_tenant ON procedimentos_catalogo_versoes (tenant_id, procedimento_id);
CREATE INDEX IF NOT EXISTS idx_proc_versoes_proc_versao ON procedimentos_catalogo_versoes (procedimento_id, versao DESC);
-- Uma versão vigente por número. Se houver repetido em produção, só avisa (não derruba o resto).
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_proc_versoes_proc_versao ON procedimentos_catalogo_versoes (procedimento_id, versao);
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'procedimentos_catalogo_versoes tem (procedimento_id, versao) repetido; índice único não criado';
END $$;

-- tenant_id da versão = tenant_id do procedimento (o INSERT de criarVersaoProcedimento não manda).
CREATE OR REPLACE FUNCTION b2b3_proc_versoes_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT pc.tenant_id INTO NEW.tenant_id FROM procedimentos_catalogo pc WHERE pc.id = NEW.procedimento_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_proc_versoes_tenant'
                   AND tgrelid = 'public.procedimentos_catalogo_versoes'::regclass) THEN
    CREATE TRIGGER trg_proc_versoes_tenant BEFORE INSERT ON procedimentos_catalogo_versoes
      FOR EACH ROW EXECUTE FUNCTION b2b3_proc_versoes_tenant();
  END IF;
END $$;
UPDATE procedimentos_catalogo_versoes v SET tenant_id = pc.tenant_id
  FROM procedimentos_catalogo pc
 WHERE v.tenant_id IS NULL AND pc.id = v.procedimento_id AND pc.tenant_id IS NOT NULL;

-- ─── B3: reativação ───────────────────────────────────────────────────────
ALTER TABLE IF EXISTS reactivation_rules ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS reactivation_sends ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS reactivation_rules ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id();
ALTER TABLE IF EXISTS reactivation_sends ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id();
CREATE INDEX IF NOT EXISTS idx_reactivation_rules_tenant ON reactivation_rules (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_reactivation_sends_tenant ON reactivation_sends (tenant_id, rule_id);

-- Regra sem clínica: clínica de quem criou (profiles.tenant_id). Sem autor/sem clínica fica NULL.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'tenant_id') THEN
    UPDATE reactivation_rules r SET tenant_id = p.tenant_id
      FROM profiles p
     WHERE r.tenant_id IS NULL AND r.created_by = p.id AND p.tenant_id IS NOT NULL;
  END IF;
END $$;
-- Envio sem clínica: clínica da regra.
UPDATE reactivation_sends s SET tenant_id = r.tenant_id
  FROM reactivation_rules r
 WHERE s.tenant_id IS NULL AND s.rule_id = r.id AND r.tenant_id IS NOT NULL;

-- O envio "falhou" de POST /api/reativacao/rules/:id/send não manda tenant_id: herda da regra.
CREATE OR REPLACE FUNCTION b2b3_reactivation_sends_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.rule_id IS NOT NULL THEN
    SELECT r.tenant_id INTO NEW.tenant_id FROM reactivation_rules r WHERE r.id = NEW.rule_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reactivation_sends_tenant'
                   AND tgrelid = 'public.reactivation_sends'::regclass) THEN
    CREATE TRIGGER trg_reactivation_sends_tenant BEFORE INSERT ON reactivation_sends
      FOR EACH ROW EXECUTE FUNCTION b2b3_reactivation_sends_tenant();
  END IF;
END $$;

-- ─── Dono, GRANT e RLS (padrão de migration-dono-tabelas-deploy.sql) ─────
-- reactivation_*: criadas pelo deploy (dono postgres) → passam para o dono de "pacientes".
-- procedimentos_*: só se este arquivo as criou agora (as antigas ficam como estão).
-- Política tenant_isolation_policy só nas tabelas criadas agora, e só se is_super_admin() existe.
DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
  nova BOOLEAN;
BEGIN
  FOREACH t IN ARRAY ARRAY['reactivation_rules', 'reactivation_sends', 'procedimentos_catalogo', 'procedimentos_catalogo_versoes'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    nova := t LIKE 'procedimentos%' AND NOT EXISTS (SELECT 1 FROM b2b3_ja_existiam j WHERE j.nome = t);
    IF (t LIKE 'reactivation%' OR nova)
       AND dono IS NOT NULL AND dono <> 'postgres'
       AND (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = t) = 'postgres' THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, dono);
      RAISE NOTICE 'dono de % -> %', t, dono;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO odonto_app', t);
    END IF;
    IF nova AND to_regprocedure('is_super_admin()') IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON public.%I', t);
      EXECUTE format($p$CREATE POLICY tenant_isolation_policy ON public.%I FOR ALL
        USING (is_super_admin() OR tenant_id = get_current_tenant_id())
        WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id())$p$, t);
    END IF;
  END LOOP;
END $$;

COMMIT;
