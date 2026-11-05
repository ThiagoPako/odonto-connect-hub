-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — listas de expurgo por prazo de guarda (lgpd-expurgo.mjs). Idempotente.
-- Autora: Renata (banco) · 2026-11-05 · Depende de migration-lgpd-titular.sql.
--
-- lgpd_expurgo_listas: uma por clínica e mês (competencia 'AAAA-MM'), gerada pelo job. Guarda o
--   dry-run (quando, quem, resultado previsto, assinatura das aprovações), quem executou e o
--   resultado só por contagens. É o registro da eliminação (Lei 13.787 art. 6º § 4º).
-- lgpd_expurgo_itens: categoria, corte (data-limite fixada na geração), quantidade, ação
--   (eliminar | devolver), aprovação (quem, papel admin|dentista, quando) e resultado.
-- Nada é apagado por esta migração.
--
-- Rollback: DROP TABLE IF EXISTS lgpd_expurgo_itens, lgpd_expurgo_listas;  -- perde o registro das eliminações (evitar)
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

CREATE TEMP TABLE expurgo_ja_existiam ON COMMIT DROP AS
  SELECT tablename::text AS nome FROM pg_tables
   WHERE schemaname = 'public' AND tablename IN ('lgpd_expurgo_listas', 'lgpd_expurgo_itens');

CREATE TABLE IF NOT EXISTS lgpd_expurgo_listas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'executada', 'descartada')),
  resumo JSONB,
  gerada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dry_run JSONB,
  dry_run_em TIMESTAMPTZ,
  dry_run_por UUID,
  dry_run_assinatura TEXT,
  executada_em TIMESTAMPTZ,
  executada_por UUID,
  resultado JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lgpd_expurgo_listas_competencia ON lgpd_expurgo_listas (tenant_id, competencia);

CREATE TABLE IF NOT EXISTS lgpd_expurgo_itens (
  id BIGSERIAL PRIMARY KEY,
  lista_id UUID NOT NULL REFERENCES lgpd_expurgo_listas(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL CHECK (categoria IN ('leads', 'fila', 'conversas', 'acessos', 'solicitacoes', 'prontuario')),
  referencia TEXT,                     -- paciente_id nos itens de prontuário; NULL nas categorias em massa
  quantidade INT NOT NULL DEFAULT 0,
  detalhe JSONB,                       -- contagem por tabela
  corte TIMESTAMPTZ NOT NULL,          -- data-limite fixada na geração da lista
  prazo_ate TIMESTAMPTZ,
  acao TEXT NOT NULL DEFAULT 'eliminar' CHECK (acao IN ('eliminar', 'devolver')),
  aprovado BOOLEAN NOT NULL DEFAULT false,
  aprovado_por UUID,
  aprovado_papel TEXT CHECK (aprovado_papel IN ('admin', 'dentista')),
  dentista_id UUID,
  aprovado_em TIMESTAMPTZ,
  resultado JSONB
);
CREATE INDEX IF NOT EXISTS idx_lgpd_expurgo_itens_lista ON lgpd_expurgo_itens (tenant_id, lista_id);

DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lgpd_expurgo_listas', 'lgpd_expurgo_itens'] LOOP
    IF dono IS NOT NULL AND dono <> 'postgres'
       AND NOT EXISTS (SELECT 1 FROM expurgo_ja_existiam j WHERE j.nome = t) THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, dono);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO odonto_app', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE public.lgpd_expurgo_itens_id_seq TO odonto_app;
  END IF;
END $$;

COMMIT;
