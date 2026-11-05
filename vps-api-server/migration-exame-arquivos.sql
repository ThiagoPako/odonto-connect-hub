-- Imagens e arquivos de exame (raio-x, tomografia, PDF) com dono registrado.
-- Dado de saúde: o arquivo fica em uploads/exames/<tenant_id>/ (fora do /uploads/media público)
-- e só é entregue pela API a quem é da clínica. Idempotente: pode rodar N vezes.
-- Rollback: DROP TABLE exame_arquivos (perde só o vínculo; os arquivos continuam no disco).
-- Nenhuma linha é apagada pela aplicação: "remover" marca removido_em (prontuário, Lei 13.787 art. 6º).
CREATE TABLE IF NOT EXISTS exame_arquivos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exame_id       UUID NOT NULL REFERENCES exames(id) ON DELETE CASCADE,
  paciente_id    UUID,
  caminho        TEXT NOT NULL UNIQUE,
  nome_original  TEXT,
  mime_type      TEXT NOT NULL,
  tamanho_bytes  BIGINT NOT NULL DEFAULT 0,
  descricao      TEXT,
  enviado_por    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removido_em    TIMESTAMPTZ,
  removido_por   UUID
);
CREATE INDEX IF NOT EXISTS idx_exame_arquivos_tenant_exame ON exame_arquivos (tenant_id, exame_id);
CREATE INDEX IF NOT EXISTS idx_exame_arquivos_tenant_paciente ON exame_arquivos (tenant_id, paciente_id);

ALTER TABLE exame_arquivos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exame_arquivos_tenant_isolation ON exame_arquivos;
CREATE POLICY exame_arquivos_tenant_isolation ON exame_arquivos
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  );
