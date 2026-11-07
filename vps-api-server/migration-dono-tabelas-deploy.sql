-- SÓ DE DEPLOY (deploy.yml, como postgres). NÃO colocar no auto-migration do boot do server.mjs:
-- o boot divide o arquivo em ";\s*\n" e quebraria o bloco DO.
--
-- Por quê: o deploy cria tabelas como postgres. O pg_default_acl do postgres dá GRANT ao
-- odonto_app, mas o dono fica postgres; com ENABLE ROW LEVEL SECURITY a política passa a valer
-- para o odonto_app (não é dono) e tudo que roda sem contexto de clínica (jobs, ex.: log de saúde
-- do WhatsApp) é bloqueado em silêncio. Aqui a tabela passa para o mesmo dono de "pacientes"
-- (o dono das tabelas da API), como se a própria API a tivesse criado. Mesmo padrão de
-- migration-schema-alinhamento.sql (bloco "Tabela CRIADA AGORA").
--
-- Idempotente: tabela ausente é pulada (to_regclass); dono já certo não muda; GRANT repetido
-- não dá erro. ALTER TABLE ... OWNER leva junto as sequências da tabela (BIGSERIAL).
-- Rodar logo depois de migration-lista-espera.sql, migration-whatsapp-saude.sql, migration-whatsapp-canais.sql e
-- migration-ia-revisao-humana.sql, com
-- PGOPTIONS='-c lock_timeout=5s'.
-- Rollback: ALTER TABLE <tabela> OWNER TO postgres; (volta a RLS a valer para o odonto_app).
\set ON_ERROR_STOP on

DO $$
DECLARE
  dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
  t TEXT;
  seq TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lista_espera', 'lista_espera_ofertas', 'whatsapp_instance_health_log', 'whatsapp_opt_outs', 'whatsapp_opt_out_reversals', 'whatsapp_channels', 'whatsapp_webhook_events', 'prontuario_versoes', 'exportacoes_relatorios_ia'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    IF dono IS NOT NULL AND dono <> 'postgres'
       AND (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = t) = 'postgres' THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, dono);
      RAISE NOTICE 'dono de % -> %', t, dono;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO odonto_app', t);
      -- Sequências da tabela (BIGSERIAL/IDENTITY): INSERT precisa de nextval.
      FOR seq IN
        SELECT s.oid::regclass::text FROM pg_class s
          JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
         WHERE s.relkind = 'S' AND d.refobjid = to_regclass('public.' || t)
      LOOP
        EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO odonto_app', seq);
      END LOOP;
    END IF;
  END LOOP;
END $$;
