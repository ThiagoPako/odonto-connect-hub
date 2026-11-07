-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — prova do aceite de documentos legais. Idempotente: pode rodar N vezes.
-- Autora: Renata (banco) · 2026-11-05 · Usado por vps-api-server/legal.mjs.
--
-- Antes: o aceite ficava em colunas de tenants (termos_versao, politica_versao, termos_aceitos_em,
-- termos_aceite_ip), sobrescritas a cada aceite, e a prova se perdia. As colunas continuam
-- (compatibilidade). Agora:
--   documentos_legais_versoes: cada versão publicada (texto + hash sha256, aviso e vigência:
--     vale 30 dias depois do aviso). Versão publicada não muda.
--   aceites_documentos: um registro por aceite (clínica, usuário, documento, versão, hash do texto,
--     data, IP). Só inclusão: UPDATE/DELETE/TRUNCATE bloqueados, salvo a exclusão da clínica inteira.
-- Inclui o aceite já gravado em tenants como registro inicial (origem = 'tenants'), uma vez.
--
-- Rollback: tabelas novas.
--   DROP TABLE IF EXISTS aceites_documentos;          -- perde a prova dos aceites (evitar)
--   DROP TABLE IF EXISTS documentos_legais_versoes;
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

CREATE TEMP TABLE aceites_ja_existiam ON COMMIT DROP AS
  SELECT tablename::text AS nome FROM pg_tables
   WHERE schemaname = 'public' AND tablename IN ('aceites_documentos', 'documentos_legais_versoes');

CREATE TABLE IF NOT EXISTS documentos_legais_versoes (
  documento TEXT NOT NULL CHECK (documento IN ('termos', 'politica', 'modelo_clinica')),
  versao TEXT NOT NULL,
  texto TEXT,                          -- texto integral publicado (NULL nas versões anteriores a esta tabela)
  hash_texto TEXT,                     -- sha256 do texto
  publicado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  avisado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vigente_em TIMESTAMPTZ NOT NULL,     -- avisado_em + 30 dias, no mínimo
  PRIMARY KEY (documento, versao)
);

-- Versões 1.0 em uso hoje (src/lib/legal.ts: TERMOS_VERSAO e POLITICA_VERSAO, de 04/11/2026).
-- Ficam sem texto/hash (são anteriores a esta tabela): o texto da 1.0 está no histórico do git
-- (src/routes/termos.tsx e privacidade.tsx). Da próxima versão em diante, o texto e o hash são
-- gravados ao publicar (POST /api/legal/documentos).
INSERT INTO documentos_legais_versoes (documento, versao, avisado_em, vigente_em)
VALUES ('termos', '1.0', '2026-11-04 00:00:00-03', '2026-11-04 00:00:00-03'),
       ('politica', '1.0', '2026-11-04 00:00:00-03', '2026-11-04 00:00:00-03')
ON CONFLICT (documento, versao) DO NOTHING;

CREATE TABLE IF NOT EXISTS aceites_documentos (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID,                     -- sem FK: a prova fica mesmo se o usuário sair
  documento TEXT NOT NULL CHECK (documento IN ('termos', 'politica', 'modelo_clinica')),
  versao TEXT NOT NULL,
  hash_texto TEXT,
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip TEXT,
  user_agent TEXT,
  origem TEXT NOT NULL DEFAULT 'app'   -- 'app' | 'tenants' (importado das colunas antigas)
);
CREATE INDEX IF NOT EXISTS idx_aceites_documentos_tenant ON aceites_documentos (tenant_id, documento, versao);

-- Importa o aceite que já estava em tenants (uma vez por clínica e documento). Pula se as
-- colunas antigas ainda não existem (elas vêm do boot ou da migration-schema-alinhamento.sql).
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenants'
         AND column_name IN ('termos_versao', 'politica_versao', 'termos_aceitos_em', 'termos_aceite_ip')) < 4 THEN
    RAISE NOTICE '[aceites] tenants sem as colunas de aceite: nada a importar';
    RETURN;
  END IF;
  EXECUTE $q$
    INSERT INTO aceites_documentos (tenant_id, usuario_id, documento, versao, aceito_em, ip, origem)
    SELECT t.id, NULL, d.documento, d.versao, COALESCE(t.termos_aceitos_em, t.created_at, NOW()), t.termos_aceite_ip, 'tenants'
      FROM tenants t
      CROSS JOIN LATERAL (VALUES ('termos', t.termos_versao), ('politica', t.politica_versao)) AS d(documento, versao)
     WHERE d.versao IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM aceites_documentos a
                        WHERE a.tenant_id = t.id AND a.documento = d.documento AND a.versao = d.versao)$q$;
END $$;

-- Só inclusão. DELETE só quando a clínica inteira sai (cascata a partir de tenants).
CREATE OR REPLACE FUNCTION aceites_documentos_somente_inclusao() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'aceites_documentos é só de inclusão (%)', TG_OP USING ERRCODE = '42501';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_aceites_documentos_somente_inclusao ON aceites_documentos;
CREATE TRIGGER trg_aceites_documentos_somente_inclusao BEFORE UPDATE OR DELETE ON aceites_documentos
  FOR EACH ROW EXECUTE FUNCTION aceites_documentos_somente_inclusao();
DROP TRIGGER IF EXISTS trg_aceites_documentos_sem_truncate ON aceites_documentos;
CREATE TRIGGER trg_aceites_documentos_sem_truncate BEFORE TRUNCATE ON aceites_documentos
  FOR EACH STATEMENT EXECUTE FUNCTION aceites_documentos_somente_inclusao();

-- Versão publicada não muda (o hash é a prova do que foi aceito).
CREATE OR REPLACE FUNCTION documentos_legais_versoes_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'versão publicada não pode ser alterada nem apagada; publique uma versão nova' USING ERRCODE = '42501';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_documentos_legais_versoes_imutavel ON documentos_legais_versoes;
CREATE TRIGGER trg_documentos_legais_versoes_imutavel BEFORE UPDATE OR DELETE ON documentos_legais_versoes
  FOR EACH ROW EXECUTE FUNCTION documentos_legais_versoes_imutavel();

-- Tabela criada agora (deploy como postgres) vai para o dono das tabelas da API; GRANT ao odonto_app.
DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['aceites_documentos', 'documentos_legais_versoes'] LOOP
    IF dono IS NOT NULL AND dono <> 'postgres'
       AND NOT EXISTS (SELECT 1 FROM aceites_ja_existiam j WHERE j.nome = t) THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, dono);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO odonto_app', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE public.aceites_documentos_id_seq TO odonto_app;
  END IF;
END $$;

COMMIT;
