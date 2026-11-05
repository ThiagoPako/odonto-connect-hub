-- Exames: autoria do laudo (quem finalizou e quando; última edição do texto).
-- Idempotente: pode rodar N vezes. Rollback: colunas opcionais, podem ficar.
ALTER TABLE IF EXISTS exames ADD COLUMN IF NOT EXISTS laudado_por UUID;
ALTER TABLE IF EXISTS exames ADD COLUMN IF NOT EXISTS laudado_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS exames ADD COLUMN IF NOT EXISTS laudo_atualizado_por UUID;
ALTER TABLE IF EXISTS exames ADD COLUMN IF NOT EXISTS laudo_atualizado_em TIMESTAMPTZ;

-- updated_at é a "versão" usada para detectar duas pessoas salvando o mesmo exame
-- (o gatilho trg_exames_updated é criado junto com a tabela, no boot ou no alinhamento #39)

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
-- A API cria estas estruturas no boot; este arquivo não está no deploy.yml. Se rodado à mão
-- como postgres, a tabela nova passa para o dono de pacientes e a RLS fica para o FORCE.
DO $$
DECLARE dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
BEGIN
  IF dono IS NOT NULL AND (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'exame_laudo_historico') <> dono THEN
    EXECUTE format('ALTER TABLE public.exame_laudo_historico OWNER TO %I', dono);
  END IF;
END $$;
