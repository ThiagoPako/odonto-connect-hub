-- Diagnóstico de RLS — SOMENTE LEITURA. Não altera nada.
-- Rodar na VPS antes e depois da virada (plano: docs/banco/plano-virada-rls.md):
--   sudo -u postgres psql -p 5433 -d odonto_db -f docs/banco/diagnostico-rls.sql > diag-$(date +%F-%H%M).txt
\pset pager off

\echo '== 1. Versão do Postgres (15+ muda permissão de CREATE no schema public)'
SELECT version();

\echo '== 2. Roles: quem é superusuário ou ignora RLS'
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole
  FROM pg_roles WHERE rolcanlogin OR rolname = 'odonto_app'
 ORDER BY 1;

\echo '== 3. Configuração do role odonto_app (app.rls_modo)'
SELECT r.rolname, d.datname, s.setconfig
  FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
  LEFT JOIN pg_database d ON d.oid = s.setdatabase
 WHERE r.rolname = 'odonto_app';

\echo '== 4. Tabelas: dono, RLS, FORCE, tenant_id, NOT NULL, índice por tenant_id'
SELECT c.relname AS tabela,
       pg_get_userbyid(c.relowner) AS dono,
       c.relrowsecurity AS rls,
       c.relforcerowsecurity AS force,
       col.data_type AS tenant_id_tipo,
       (col.is_nullable = 'NO') AS tenant_not_null,
       EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                WHERE i.indrelid = c.oid AND a.attname = 'tenant_id') AS indice_tenant,
       (SELECT string_agg(policyname, ', ' ORDER BY policyname) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS politicas,
       c.reltuples::bigint AS linhas_aprox
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  LEFT JOIN information_schema.columns col
         ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
 WHERE c.relkind IN ('r', 'p')
 ORDER BY (col.data_type IS NULL), c.relname;

\echo '== 5. Políticas que convertem configuração direto para uuid (quebram com valor vazio)'
SELECT tablename, policyname, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (COALESCE(qual, '') ~ 'current_setting\(.*\)\)?::uuid' OR COALESCE(with_check, '') ~ 'current_setting\(.*\)\)?::uuid');

\echo '== 6. Registros sem clínica (tenant_id NULL) por tabela'
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'tenant_id'
              AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
            ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', r.table_name) INTO n;
    IF n > 0 THEN RAISE NOTICE '% : % sem clínica', r.table_name, n; END IF;
  END LOOP;
END $$;

\echo '== 7. Views e funções SECURITY DEFINER (rodam com o privilégio do dono)'
SELECT 'view' AS tipo, viewname AS nome, viewowner AS dono FROM pg_views WHERE schemaname = 'public'
UNION ALL
SELECT 'security definer', p.proname, pg_get_userbyid(p.proowner)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef;

\echo '== 8. Conexões abertas por usuário (depois da virada: odonto_app)'
SELECT usename, application_name, count(*) FROM pg_stat_activity
 WHERE datname = current_database() GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '== 9. Privilégios do odonto_app numa tabela de exemplo (esperado: SELECT, INSERT, UPDATE, DELETE)'
SELECT privilege_type FROM information_schema.role_table_grants
 WHERE grantee = 'odonto_app' AND table_name = 'pacientes' ORDER BY 1;
