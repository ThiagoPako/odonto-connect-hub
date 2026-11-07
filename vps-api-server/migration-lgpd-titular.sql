-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — LGPD: pedidos do titular (art. 18) e registro de acesso ao prontuário.
-- Idempotente: pode rodar N vezes. Autora: Renata (banco) · 2026-11-05
-- Usado por vps-api-server/lgpd.mjs. Plano de retenção: docs/banco/retencao-lgpd.md.
--
-- lgpd_solicitacoes: quem pediu, quando, o que (exportar/excluir/anonimizar), quem confirmou,
--   resultado (só contagens por tabela; nunca conteúdo). Não tem FK para pacientes: o registro do
--   atendimento ao direito fica mesmo depois da eliminação (LGPD art. 37; defesa, art. 7º VI).
-- acessos_prontuario: quem abriu anamnese/odontograma/exames/prontuário de qual paciente e quando.
--   Sem dado de saúde. Retenção proposta: 5 anos (docs/banco/retencao-lgpd.md, depende da Helena).
--
-- Rollback: tabelas novas, sem dependência no resto do schema.
--   DROP TABLE IF EXISTS acessos_prontuario;  -- perde o histórico de acessos
--   DROP TABLE IF EXISTS lgpd_solicitacoes;   -- perde a prova de atendimento aos pedidos (evitar)
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

CREATE TEMP TABLE lgpd_ja_existiam ON COMMIT DROP AS
  SELECT tablename::text AS nome FROM pg_tables
   WHERE schemaname = 'public' AND tablename IN ('lgpd_solicitacoes', 'acessos_prontuario');

CREATE TABLE IF NOT EXISTS lgpd_solicitacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('exportar', 'excluir', 'anonimizar')),
  status TEXT NOT NULL DEFAULT 'aguardando_confirmacao'
    CHECK (status IN ('aguardando_confirmacao', 'executada', 'cancelada', 'expirada', 'recusada')),
  origem TEXT NOT NULL DEFAULT 'titular' CHECK (origem IN ('titular', 'representante', 'clinica')),
  motivo TEXT,                         -- curto; sem dado de saúde
  solicitado_por UUID,
  solicitado_por_email TEXT,
  solicitado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  codigo_hash TEXT,                    -- sha256 do código de confirmação; apagado ao encerrar
  expira_em TIMESTAMPTZ,
  tentativas INT NOT NULL DEFAULT 0,
  confirmado_por UUID,
  confirmado_por_email TEXT,
  executado_em TIMESTAMPTZ,
  motivo_recusa TEXT,
  resumo JSONB                         -- contagens por tabela, prazos de retenção
);
ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS tentativas INT NOT NULL DEFAULT 0;
ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS motivo_recusa TEXT;
-- Quem conferiu a identidade e com qual documento (sem o número); representante do menor (LGPD 14, 18 § 3º).
ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS identidade_conferida_por TEXT;
ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS identidade_documento TEXT;
ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS representante_nome TEXT;
ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS representante_vinculo TEXT;
-- Ao fim da guarda: eliminar ou devolver o prontuário ao paciente (Lei 13.787 art. 6º § 2º).
ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS ao_fim_do_prazo TEXT;
-- A clínica optou por eliminar as conversas de paciente com prontuário (assume a perda da prova).
ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS eliminar_conversas BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_lgpd_solicitacoes_tenant ON lgpd_solicitacoes (tenant_id, paciente_id, solicitado_em DESC);

CREATE TABLE IF NOT EXISTS acessos_prontuario (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID,
  paciente_id TEXT NOT NULL,
  recurso TEXT NOT NULL,               -- anamnese | odontograma | exame | prontuario
  acao TEXT NOT NULL DEFAULT 'visualizar',
  em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acessos_prontuario_paciente ON acessos_prontuario (tenant_id, paciente_id, em DESC);
CREATE INDEX IF NOT EXISTS idx_acessos_prontuario_em ON acessos_prontuario (tenant_id, em);

-- acessos_prontuario é só de inclusão: UPDATE e TRUNCATE nunca; DELETE só no expurgo (registro com
-- mais de 5 anos e a sessão marcada com SET odonto.expurgo_acessos = 'on') ou quando a clínica
-- inteira é excluída (cascata a partir de tenants).
CREATE OR REPLACE FUNCTION acessos_prontuario_somente_inclusao() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
    IF current_setting('odonto.expurgo_acessos', true) = 'on' AND OLD.em < NOW() - INTERVAL '5 years' THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'acessos_prontuario é só de inclusão (%)', TG_OP USING ERRCODE = '42501';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_acessos_prontuario_somente_inclusao ON acessos_prontuario;
CREATE TRIGGER trg_acessos_prontuario_somente_inclusao BEFORE UPDATE OR DELETE ON acessos_prontuario
  FOR EACH ROW EXECUTE FUNCTION acessos_prontuario_somente_inclusao();
DROP TRIGGER IF EXISTS trg_acessos_prontuario_sem_truncate ON acessos_prontuario;
CREATE TRIGGER trg_acessos_prontuario_sem_truncate BEFORE TRUNCATE ON acessos_prontuario
  FOR EACH STATEMENT EXECUTE FUNCTION acessos_prontuario_somente_inclusao();

-- RLS: NÃO liga aqui. Em produção há tabelas cujo dono é o postgres, com RLS que depende do
-- contexto da sessão (PR #32). Se estas nascerem do postgres com política, o INSERT do log de
-- acesso, feito numa conexão do pool sem contexto, seria bloqueado. A política e o FORCE entram
-- com a migration-force-rls.sql (#14), que pega toda tabela com tenant_id. Até lá, o isolamento
-- é o filtro tenant_id em toda query de lgpd.mjs.

-- Tabela criada agora (o deploy roda como postgres) vai para o dono das tabelas da API, como se a
-- API a tivesse criado. Tabela que já existia fica como está.
DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lgpd_solicitacoes', 'acessos_prontuario'] LOOP
    IF dono IS NOT NULL AND dono <> 'postgres'
       AND NOT EXISTS (SELECT 1 FROM lgpd_ja_existiam j WHERE j.nome = t) THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, dono);  -- a sequência do BIGSERIAL acompanha
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO odonto_app', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE public.acessos_prontuario_id_seq TO odonto_app;
  END IF;
END $$;

COMMIT;
