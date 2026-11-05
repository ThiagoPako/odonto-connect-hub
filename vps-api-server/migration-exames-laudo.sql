-- Exames: autoria do laudo (quem finalizou e quando; última edição do texto).
-- Idempotente: pode rodar N vezes. Rollback: colunas opcionais, podem ficar.
ALTER TABLE IF EXISTS exames ADD COLUMN IF NOT EXISTS laudado_por UUID;
ALTER TABLE IF EXISTS exames ADD COLUMN IF NOT EXISTS laudado_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS exames ADD COLUMN IF NOT EXISTS laudo_atualizado_por UUID;
ALTER TABLE IF EXISTS exames ADD COLUMN IF NOT EXISTS laudo_atualizado_em TIMESTAMPTZ;

-- updated_at é a "versão" usada para detectar duas pessoas salvando o mesmo exame
CREATE OR REPLACE FUNCTION exames_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_exames_updated ON exames;
CREATE TRIGGER trg_exames_updated BEFORE UPDATE ON exames
  FOR EACH ROW EXECUTE FUNCTION exames_touch_updated_at();

-- Histórico do laudo: cada finalização e reabertura com o texto daquele momento
-- (reabrir não apaga o texto que foi assinado). Linhas nunca são alteradas pela aplicação.
CREATE TABLE IF NOT EXISTS exame_laudo_historico (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exame_id    UUID NOT NULL REFERENCES exames(id) ON DELETE CASCADE,
  acao        TEXT NOT NULL CHECK (acao IN ('finalizado', 'reaberto')),
  laudo_texto TEXT,
  autor_id    UUID,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exame_laudo_historico_tenant_exame ON exame_laudo_historico (tenant_id, exame_id, criado_em DESC);
ALTER TABLE exame_laudo_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exame_laudo_historico_tenant_isolation ON exame_laudo_historico;
CREATE POLICY exame_laudo_historico_tenant_isolation ON exame_laudo_historico
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  );
