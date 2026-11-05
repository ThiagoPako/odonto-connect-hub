-- Integridade do prontuário (Lei 13.787/2018; CFO): nada de apagar nem reescrever em silêncio.
-- Autor do registro, versão atual, quem editou, inativação lógica com motivo e autor, e o
-- histórico de versões em prontuario_versoes. Idempotente; também roda no boot (server.mjs).
-- Rollback: colunas/tabela novas são aditivas e podem ficar. Remover prontuario_versoes PERDE o
-- histórico clínico (não fazer sem decisão jurídica).
-- Retenção: prontuário e versões seguem o prazo de 20 anos (Lei 13.787/2018 art. 6º).
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS criado_por UUID;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS criado_por_nome TEXT;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS editado_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS editado_por UUID;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS editado_por_nome TEXT;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS inativo_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS inativo_por UUID;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS inativo_por_nome TEXT;
ALTER TABLE IF EXISTS prontuarios ADD COLUMN IF NOT EXISTS inativo_motivo TEXT;

CREATE TABLE IF NOT EXISTS prontuario_versoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prontuario_id UUID NOT NULL REFERENCES prontuarios(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  versao INTEGER NOT NULL,
  titulo TEXT, descricao TEXT, tipo TEXT, odontograma JSONB, anexos JSONB,
  autor_id UUID, autor_nome TEXT, registrado_em TIMESTAMPTZ,
  substituida_por UUID, substituida_por_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prontuario_versoes_tenant ON prontuario_versoes (tenant_id, prontuario_id, versao);
ALTER TABLE prontuario_versoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON prontuario_versoes;
CREATE POLICY tenant_isolation_policy ON prontuario_versoes FOR ALL
  USING (is_super_admin() OR tenant_id = get_current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id());

-- Dados já gravados com status vazio (ver PR): corrigir só depois de revisar, ex.:
--   UPDATE tratamentos SET status = 'planejado', updated_at = NOW() WHERE COALESCE(status, '') = '';
