-- Recupera a clínica de contatos antigos que ficaram com tenant_id NULL depois
-- da migration-seguranca-p0.sql (eles sumiram da tela Contatos).
--
-- Regra segura: o telefone do contato (8 últimos dígitos, tolerante ao 9º
-- dígito) precisa aparecer em conversas do WhatsApp (chat_messages) e/ou leads
-- (crm_leads) de UMA ÚNICA clínica. Se aparecer em duas ou mais, ou em nenhuma,
-- o contato continua sem clínica e entra na contagem do NOTICE.
--
-- Idempotente: só toca linhas com tenant_id NULL. Não apaga nada.
-- Rollback: UPDATE contatos SET tenant_id = NULL WHERE id IN (...) — os ids
-- alterados aparecem no NOTICE só como contagem; para auditoria completa, rode
-- a consulta de conferência do fim antes e depois.

DO $$
DECLARE
  n_antes INT;
  n_atrib INT;
  n_depois INT;
BEGIN
  IF to_regclass('public.contatos') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'contatos' AND column_name = 'tenant_id') THEN
    RAISE NOTICE '[contatos] tabela ou coluna tenant_id ausente, nada a fazer';
    RETURN;
  END IF;

  SELECT count(*) INTO n_antes FROM contatos WHERE tenant_id IS NULL;
  IF n_antes = 0 THEN
    RAISE NOTICE '[contatos] nenhum contato sem clínica';
    RETURN;
  END IF;

  WITH origem AS (
    -- telefones vistos por clínica nas conversas
    SELECT RIGHT(regexp_replace(phone, '\D', '', 'g'), 8) AS chave, tenant_id
      FROM chat_messages
     WHERE tenant_id IS NOT NULL AND phone IS NOT NULL
       AND length(regexp_replace(phone, '\D', '', 'g')) >= 10
    UNION
    -- e nos leads do CRM
    SELECT RIGHT(regexp_replace(telefone, '\D', '', 'g'), 8), tenant_id
      FROM crm_leads
     WHERE tenant_id IS NOT NULL AND telefone IS NOT NULL
       AND length(regexp_replace(telefone, '\D', '', 'g')) >= 10
  ),
  unica AS (
    SELECT chave, min(tenant_id::text)::uuid AS tenant_id
      FROM origem
     GROUP BY chave
    HAVING count(DISTINCT tenant_id) = 1
  )
  UPDATE contatos c
     SET tenant_id = u.tenant_id
    FROM unica u
   WHERE c.tenant_id IS NULL
     AND c.telefone IS NOT NULL
     AND length(regexp_replace(c.telefone, '\D', '', 'g')) >= 10
     AND RIGHT(regexp_replace(c.telefone, '\D', '', 'g'), 8) = u.chave;
  GET DIAGNOSTICS n_atrib = ROW_COUNT;

  SELECT count(*) INTO n_depois FROM contatos WHERE tenant_id IS NULL;
  RAISE NOTICE '[contatos] sem clínica antes: %, atribuídos: %, ainda sem clínica: %', n_antes, n_atrib, n_depois;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[contatos] recuperação ignorada (%)', SQLERRM;
END $$;

-- Conferência (somente leitura):
-- SELECT count(*) FILTER (WHERE tenant_id IS NULL) AS sem_clinica, count(*) AS total FROM contatos;
