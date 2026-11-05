-- L7: dono (clínica) de cada arquivo de uploads/media (chat, avatar, uploads).
-- A API cria esta tabela no boot (dona = usuário da API) e preenche os arquivos antigos uma vez
-- (backfillMediaFiles, marca em media_files_backfill). Este arquivo NÃO está no deploy.yml:
-- se for rodado à mão como postgres, as tabelas passam para o dono de pacientes.
-- RLS desligada por enquanto: a rota de link assinado roda sem contexto de clínica; o filtro
-- por tenant_id está nas queries. RLS entra com a virada do FORCE.
-- Idempotente. Rollback: MEDIA_AUTH_MODE=public no .env (a tabela pode ficar).
CREATE TABLE IF NOT EXISTS media_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  path        TEXT NOT NULL UNIQUE,          -- 'AAAA-MM/<uuid>.<ext>' (sem /uploads/media/)
  mime_type   TEXT,
  size_bytes  BIGINT,
  kind        TEXT NOT NULL DEFAULT 'other', -- chat | avatar | upload | exame | prontuario | other
  uploaded_by UUID,
  paciente_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_files_tenant ON media_files (tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS media_files_backfill (
  versao       INT PRIMARY KEY,
  executado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registrados  INT
);
DO $$
DECLARE dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['media_files', 'media_files_backfill'] LOOP
    IF dono IS NOT NULL AND (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = t) <> dono THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, dono);
    END IF;
  END LOOP;
END $$;
