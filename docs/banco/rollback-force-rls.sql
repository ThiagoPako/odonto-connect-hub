-- Rollback da migration-force-rls.sql. Rodar como postgres, DEPOIS de voltar a API para o
-- usuário antigo (PG_USER/PG_PASSWORD antigos no .env + pm2 restart odonto-api --update-env).
-- Testado no ensaio (docs/banco/ensaio-migracoes.md): a API volta a funcionar como antes.
-- Não apaga dado nenhum. Colunas tenant_id, índices e preenchimento do P0/M0 ficam (são
-- usados pelo código novo). Depois, tire migration-force-rls.sql do deploy.yml, senão o
-- próximo deploy reaplica.
--   sudo -u postgres psql -p 5433 -d odonto_db -f docs/banco/rollback-force-rls.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE r record; n_force INT := 0; n_pol INT := 0;
BEGIN
  -- 1. Tira o FORCE de todas as tabelas
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relforcerowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.relname);
    n_force := n_force + 1;
  END LOOP;
  -- 2. Apaga as políticas criadas pela migração
  FOR r IN SELECT tablename, policyname FROM pg_policies
            WHERE schemaname = 'public' AND policyname IN ('rls_clinica_v1', 'rls_global_escrita_v1') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    n_pol := n_pol + 1;
  END LOOP;
  RAISE NOTICE '[rollback] FORCE retirado de % tabela(s); % política(s) apagada(s)', n_force, n_pol;
END $$;

-- 3. O role da aplicação não loga mais (pode ficar; não é dono de nada).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
    ALTER ROLE odonto_app NOLOGIN;
  END IF;
END $$;

-- Conferência: as duas contagens têm de ser 0
SELECT (SELECT count(*) FROM pg_class WHERE relforcerowsecurity) AS tabelas_com_force,
       (SELECT count(*) FROM pg_policies WHERE policyname IN ('rls_clinica_v1', 'rls_global_escrita_v1')) AS politicas_novas;
COMMIT;
