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
