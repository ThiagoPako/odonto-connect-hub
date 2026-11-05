-- Segredo do webhook da Clinicorp guardado só como hash (sha256 hex).
-- O segredo passa a ser gerado pelo servidor (POST /api/clinicorp/my-settings/rotate-secret);
-- o webhook compara o sha256 do valor recebido com o hash atual ou com o anterior
-- ainda dentro do prazo (anterior_expira_em).
-- Idempotente: pode rodar N vezes. O server.mjs (registerClinicorp) aplica o mesmo no boot.
-- Não roda dentro de transação (CREATE INDEX CONCURRENTLY): use psql -f ou stdin, sem BEGIN.
--
-- 2ª etapa (NÃO feita aqui): depois que todas as clínicas tiverem gerado um segredo novo
-- (ou após confirmar que o webhook só usa o hash), apagar a coluna em claro:
--   ALTER TABLE clinicorp_user_settings DROP COLUMN IF EXISTS webhook_secret;
--
-- Rollback: colunas e índice são opcionais e podem ficar. Para remover:
--   DROP INDEX CONCURRENTLY IF EXISTS uq_clinicorp_user_settings_webhook_secret_hash;
--   ALTER TABLE clinicorp_user_settings DROP COLUMN IF EXISTS anterior_expira_em,
--     DROP COLUMN IF EXISTS webhook_secret_anterior_hash, DROP COLUMN IF EXISTS webhook_secret_hash;
--   (perde-se o segredo gerado depois desta migração; o código antigo volta a usar webhook_secret)

ALTER TABLE IF EXISTS clinicorp_user_settings ADD COLUMN IF NOT EXISTS webhook_secret_hash TEXT;
ALTER TABLE IF EXISTS clinicorp_user_settings ADD COLUMN IF NOT EXISTS webhook_secret_anterior_hash TEXT;
ALTER TABLE IF EXISTS clinicorp_user_settings ADD COLUMN IF NOT EXISTS anterior_expira_em TIMESTAMPTZ;

-- Preenche o hash a partir do segredo atual (só linhas ainda sem hash).
UPDATE clinicorp_user_settings
   SET webhook_secret_hash = encode(sha256(convert_to(webhook_secret, 'UTF8')), 'hex')
 WHERE webhook_secret_hash IS NULL
   AND webhook_secret IS NOT NULL
   AND webhook_secret <> '';

-- Se uma execução anterior do CONCURRENTLY falhou, o índice fica INVALID e o
-- IF NOT EXISTS abaixo o deixaria assim: remove só nesse caso.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'uq_clinicorp_user_settings_webhook_secret_hash' AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX uq_clinicorp_user_settings_webhook_secret_hash';
  END IF;
END $$;

-- Dois usuários nunca podem ter o mesmo segredo (o webhook acha a clínica pelo hash).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_clinicorp_user_settings_webhook_secret_hash
  ON clinicorp_user_settings (webhook_secret_hash)
  WHERE webhook_secret_hash IS NOT NULL;
