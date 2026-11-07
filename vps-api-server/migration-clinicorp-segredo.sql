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
--   ALTER TABLE clinicorp_user_settings DROP COLUMN IF EXISTS webhook_secret_legado_ate,
--     DROP COLUMN IF EXISTS anterior_expira_em,
--     DROP COLUMN IF EXISTS webhook_secret_anterior_hash, DROP COLUMN IF EXISTS webhook_secret_hash;
--   (perde-se o segredo gerado depois desta migração; o código antigo volta a usar webhook_secret)

ALTER TABLE IF EXISTS clinicorp_user_settings ADD COLUMN IF NOT EXISTS webhook_secret_hash TEXT;
ALTER TABLE IF EXISTS clinicorp_user_settings ADD COLUMN IF NOT EXISTS webhook_secret_anterior_hash TEXT;
ALTER TABLE IF EXISTS clinicorp_user_settings ADD COLUMN IF NOT EXISTS anterior_expira_em TIMESTAMPTZ;
-- Até quando o segredo legado (escolhido pelo usuário) ainda é aceito.
ALTER TABLE IF EXISTS clinicorp_user_settings ADD COLUMN IF NOT EXISTS webhook_secret_legado_ate TIMESTAMPTZ;

-- Segredo em claro repetido entre usuários: apaga o claro (e o hash derivado dele)
-- antes de calcular hashes. Sem isso, quando um dos dois gerasse segredo novo, o
-- segredo antigo voltaria a valer para o outro. As clínicas afetadas geram segredo novo.
UPDATE clinicorp_user_settings
   SET webhook_secret_hash = CASE
         WHEN webhook_secret_hash = encode(sha256(convert_to(webhook_secret, 'UTF8')), 'hex') THEN NULL
         ELSE webhook_secret_hash END,
       webhook_secret = NULL
 WHERE webhook_secret IN (
   SELECT webhook_secret FROM clinicorp_user_settings
    WHERE webhook_secret IS NOT NULL AND webhook_secret <> ''
    GROUP BY webhook_secret HAVING COUNT(*) > 1);

-- Preenche o hash a partir do segredo atual (só linhas ainda sem hash e só segredo que
-- não se repete entre usuários: segredo repetido fica sem hash e a clínica gera um novo).
UPDATE clinicorp_user_settings
   SET webhook_secret_hash = encode(sha256(convert_to(webhook_secret, 'UTF8')), 'hex')
 WHERE webhook_secret_hash IS NULL
   AND webhook_secret IS NOT NULL
   AND webhook_secret <> ''
   AND webhook_secret IN (
     SELECT webhook_secret FROM clinicorp_user_settings
      WHERE webhook_secret IS NOT NULL AND webhook_secret <> ''
      GROUP BY webhook_secret HAVING COUNT(*) = 1);

-- Segredo legado: vale por 30 dias a partir da primeira execução desta migração.
-- (Só marca a linha cujo hash ainda é o do segredo em claro; o rotate zera o claro.)
UPDATE clinicorp_user_settings
   SET webhook_secret_legado_ate = NOW() + make_interval(days => 30)
 WHERE webhook_secret_legado_ate IS NULL
   AND webhook_secret IS NOT NULL
   AND webhook_secret <> ''
   AND webhook_secret_hash = encode(sha256(convert_to(webhook_secret, 'UTF8')), 'hex');

-- Hash repetido entre usuários: não dá para saber a clínica do webhook. Zera o hash
-- dessas linhas (o webhook passa a recusar e a clínica precisa gerar segredo novo).
UPDATE clinicorp_user_settings
   SET webhook_secret_hash = NULL
 WHERE webhook_secret_hash IN (
   SELECT webhook_secret_hash FROM clinicorp_user_settings
    WHERE webhook_secret_hash IS NOT NULL
    GROUP BY webhook_secret_hash HAVING COUNT(*) > 1);

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
