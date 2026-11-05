-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — Clinicorp com mais de uma clínica: chaves únicas por clínica.
-- Autora: Renata (banco) · 2026-11-05 · Idempotente: pode rodar N vezes. Sem BEGIN no arquivo
-- (CREATE INDEX CONCURRENTLY não roda em transação); cada bloco curto tem a própria transação.
--
-- Problema: estas chaves valiam para o banco inteiro, sem tenant_id. A segunda clínica que usar o
-- Clinicorp colide com a primeira (mesmo external_id/mês/escopo) e o upsert sobrescreve ou falha:
--   clinicorp_financial_entries  UNIQUE (source, external_id)              → uq_clinicorp_financial_entries_tenant_ext (tenant_id, source, external_id)
--   clinicorp_monthly_summary    UNIQUE (source, period_month, business_id) → idx_clinicorp_monthly_summary_tenant_period (mesma definição do #39 e do boot)
--   clinicorp_local_overrides    uniq_cc_overrides_scope (scope_type, scope_id) → uq_cc_overrides_tenant_scope (tenant_id, scope_type, scope_id);
--                                tenant_id NULL = regra da plataforma (como hoje), com tenant_id = regra da clínica
--   pacientes/dentistas/agendamentos: UNIQUE global no id do Clinicorp → (tenant_id, clinicorp_*_id).
--     O id é do Clinicorp: duas clínicas que usam a mesma conta (ex.: duas unidades) ou contas
--     diferentes não podem se bloquear. O código já procura por (id, tenant_id).
--
-- Ordem em cada tabela (a regra antiga só sai com a nova VÁLIDA):
--   1. conta repetidos com a regra nova (só a contagem); havendo, não mexe naquela tabela e avisa;
--   2. CREATE UNIQUE INDEX CONCURRENTLY; índice inválido de tentativa anterior é refeito;
--   3. remove a unique global antiga (achada pelo conjunto exato de colunas, sem tenant_id).
--
-- tenant_id NULL em linhas antigas (financeiro e resumo mensal) só é preenchido quando o dono é
-- inequívoco: (a) só uma clínica usa o Clinicorp; ou (b) o business_id é de uma única clínica em
-- clinicorp_clinics; ou (c), no financeiro, o patient_id é de uma única clínica em
-- clinicorp_patients. O resto fica NULL e é contado (NOTICE). Nunca "primeiro admin".
-- Nas regras de conflito (overrides), NULL continua significando "vale para todas" (sem preencher).
--
-- Rollback (só com o código antigo, e falha se já houver o mesmo valor em duas clínicas):
--   ALTER TABLE clinicorp_financial_entries ADD CONSTRAINT clinicorp_financial_entries_source_external_id_key UNIQUE (source, external_id);
--   ALTER TABLE clinicorp_monthly_summary ADD CONSTRAINT clinicorp_monthly_summary_source_period_month_business_id_key UNIQUE (source, period_month, business_id);
--   CREATE UNIQUE INDEX uniq_cc_overrides_scope ON clinicorp_local_overrides (scope_type, COALESCE(scope_id, ''));  -- só sem regra por clínica
--   Os índices novos podem ficar. As colunas tenant_id novas são opcionais.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET lock_timeout = '5s';
\set falhou 0

-- ─── 1. Colunas tenant_id (transação curta; ADD COLUMN sem DEFAULT é só catálogo) ──────────
BEGIN;
ALTER TABLE IF EXISTS clinicorp_financial_entries ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS clinicorp_monthly_summary   ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS clinicorp_local_overrides   ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS clinicorp_override_history  ADD COLUMN IF NOT EXISTS tenant_id UUID;
COMMIT;

-- ─── 2. Preenche tenant_id NULL só com dono inequívoco (uma transação por tabela) ─────────
BEGIN;
DO $$
DECLARE
  unica UUID;
  n_unica INT;
  n BIGINT;
BEGIN
  IF to_regclass('public.clinicorp_financial_entries') IS NULL THEN RETURN; END IF;
  -- Clínicas que usam o Clinicorp (espelhos com tenant e configuração por usuário).
  CREATE TEMP TABLE IF NOT EXISTS cc_clinicas (tenant_id UUID) ON COMMIT DROP;
  TRUNCATE cc_clinicas;
  IF to_regclass('public.clinicorp_clinics') IS NOT NULL THEN
    INSERT INTO cc_clinicas SELECT DISTINCT tenant_id FROM clinicorp_clinics WHERE tenant_id IS NOT NULL;
  END IF;
  IF to_regclass('public.clinicorp_patients') IS NOT NULL THEN
    INSERT INTO cc_clinicas SELECT DISTINCT tenant_id FROM clinicorp_patients WHERE tenant_id IS NOT NULL;
  END IF;
  INSERT INTO cc_clinicas SELECT DISTINCT tenant_id FROM clinicorp_financial_entries WHERE tenant_id IS NOT NULL;
  IF to_regclass('public.clinicorp_user_settings') IS NOT NULL THEN
    INSERT INTO cc_clinicas SELECT DISTINCT p.tenant_id FROM clinicorp_user_settings s JOIN profiles p ON p.id = s.user_id
     WHERE p.tenant_id IS NOT NULL AND COALESCE(s.api_token, '') <> '';
  END IF;
  SELECT count(DISTINCT tenant_id), (array_agg(DISTINCT tenant_id))[1] INTO n_unica, unica FROM cc_clinicas;

  -- (a) uma clínica só
  IF n_unica = 1 THEN
    UPDATE clinicorp_financial_entries SET tenant_id = unica WHERE tenant_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '[clinicorp-multi] financeiro: % linha(s) da única clínica com Clinicorp', n; END IF;
  END IF;
  -- (b) business_id de uma única clínica
  IF to_regclass('public.clinicorp_clinics') IS NOT NULL THEN
    UPDATE clinicorp_financial_entries f SET tenant_id = c.tenant_id
      FROM (SELECT id, (array_agg(DISTINCT tenant_id))[1] AS tenant_id FROM clinicorp_clinics
             WHERE tenant_id IS NOT NULL GROUP BY id HAVING count(DISTINCT tenant_id) = 1) c
     WHERE f.tenant_id IS NULL AND f.business_id = c.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '[clinicorp-multi] financeiro: % linha(s) pelo business_id', n; END IF;
  END IF;
  -- (c) patient_id de uma única clínica
  IF to_regclass('public.clinicorp_patients') IS NOT NULL THEN
    UPDATE clinicorp_financial_entries f SET tenant_id = c.tenant_id
      FROM (SELECT id, (array_agg(DISTINCT tenant_id))[1] AS tenant_id FROM clinicorp_patients
             WHERE tenant_id IS NOT NULL GROUP BY id HAVING count(DISTINCT tenant_id) = 1) c
     WHERE f.tenant_id IS NULL AND f.patient_id = c.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '[clinicorp-multi] financeiro: % linha(s) pelo patient_id', n; END IF;
  END IF;
  SELECT count(*) INTO n FROM clinicorp_financial_entries WHERE tenant_id IS NULL;
  IF n > 0 THEN RAISE NOTICE '[clinicorp-multi] financeiro: % linha(s) continuam sem clínica (dono não é inequívoco)', n; END IF;
END $$;
COMMIT;

BEGIN;
DO $$
DECLARE
  unica UUID;
  n_unica INT;
  n BIGINT;
BEGIN
  IF to_regclass('public.clinicorp_monthly_summary') IS NULL THEN RETURN; END IF;
  CREATE TEMP TABLE IF NOT EXISTS cc_clinicas (tenant_id UUID) ON COMMIT DROP;
  TRUNCATE cc_clinicas;
  IF to_regclass('public.clinicorp_clinics') IS NOT NULL THEN
    INSERT INTO cc_clinicas SELECT DISTINCT tenant_id FROM clinicorp_clinics WHERE tenant_id IS NOT NULL;
  END IF;
  IF to_regclass('public.clinicorp_patients') IS NOT NULL THEN
    INSERT INTO cc_clinicas SELECT DISTINCT tenant_id FROM clinicorp_patients WHERE tenant_id IS NOT NULL;
  END IF;
  IF to_regclass('public.clinicorp_financial_entries') IS NOT NULL THEN
    INSERT INTO cc_clinicas SELECT DISTINCT tenant_id FROM clinicorp_financial_entries WHERE tenant_id IS NOT NULL;
  END IF;
  INSERT INTO cc_clinicas SELECT DISTINCT tenant_id FROM clinicorp_monthly_summary WHERE tenant_id IS NOT NULL;
  IF to_regclass('public.clinicorp_user_settings') IS NOT NULL THEN
    INSERT INTO cc_clinicas SELECT DISTINCT p.tenant_id FROM clinicorp_user_settings s JOIN profiles p ON p.id = s.user_id
     WHERE p.tenant_id IS NOT NULL AND COALESCE(s.api_token, '') <> '';
  END IF;
  SELECT count(DISTINCT tenant_id), (array_agg(DISTINCT tenant_id))[1] INTO n_unica, unica FROM cc_clinicas;

  IF n_unica = 1 THEN
    UPDATE clinicorp_monthly_summary SET tenant_id = unica WHERE tenant_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '[clinicorp-multi] resumo mensal: % linha(s) da única clínica com Clinicorp', n; END IF;
  END IF;
  IF to_regclass('public.clinicorp_clinics') IS NOT NULL THEN
    UPDATE clinicorp_monthly_summary m SET tenant_id = c.tenant_id
      FROM (SELECT id, (array_agg(DISTINCT tenant_id))[1] AS tenant_id FROM clinicorp_clinics
             WHERE tenant_id IS NOT NULL GROUP BY id HAVING count(DISTINCT tenant_id) = 1) c
     WHERE m.tenant_id IS NULL AND m.business_id = c.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '[clinicorp-multi] resumo mensal: % linha(s) pelo business_id', n; END IF;
  END IF;
  SELECT count(*) INTO n FROM clinicorp_monthly_summary WHERE tenant_id IS NULL;
  IF n > 0 THEN RAISE NOTICE '[clinicorp-multi] resumo mensal: % linha(s) continuam sem clínica (dono não é inequívoco)', n; END IF;
END $$;
COMMIT;

-- ─── 3 e 4. Índice por clínica e remoção da unique global, tabela a tabela ────────────────
-- Remoção: só índices únicos não primários, sem expressão, com EXATAMENTE as colunas antigas
-- (ordem não importa) e só se o índice novo existe e está válido. Constraint → DROP CONSTRAINT;
-- índice solto → DROP INDEX CONCURRENTLY.

-- clinicorp_financial_entries
SELECT to_regclass('public.clinicorp_financial_entries') IS NOT NULL AS tem \gset
\if :tem
  SELECT count(*) > 0 AS rep, count(*) AS n FROM (SELECT 1 FROM clinicorp_financial_entries
    GROUP BY tenant_id, source, external_id HAVING count(*) > 1 AND tenant_id IS NOT NULL) x \gset
  \if :rep
    \echo '!!! [clinicorp-multi] financeiro: lançamento repetido na mesma clínica em' :n 'caso(s); chave global mantida.'
    \set falhou 1
  \else
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_clinicorp_financial_entries_tenant_ext' AND NOT i.indisvalid) AS inval \gset
    \if :inval
      DROP INDEX CONCURRENTLY IF EXISTS uq_clinicorp_financial_entries_tenant_ext;
    \endif
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_clinicorp_financial_entries_tenant_ext
      ON clinicorp_financial_entries (tenant_id, source, external_id);
    SELECT CASE WHEN con.oid IS NOT NULL THEN format('ALTER TABLE public.%I DROP CONSTRAINT %I', t.relname, con.conname)
                ELSE format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', ic.relname) END
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid
      LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype = 'u'
     WHERE t.relname = 'clinicorp_financial_entries' AND t.relnamespace = 'public'::regnamespace
       AND i.indisunique AND NOT i.indisprimary AND ic.relname <> 'uq_clinicorp_financial_entries_tenant_ext'
       AND 0 <> ALL (i.indkey::int2[])
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int2[]) k
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['external_id', 'source']
       AND EXISTS (SELECT 1 FROM pg_index ni JOIN pg_class nc ON nc.oid = ni.indexrelid
                    WHERE nc.relname = 'uq_clinicorp_financial_entries_tenant_ext' AND ni.indisvalid) \gexec
  \endif
\endif

-- clinicorp_monthly_summary (mesmo nome e definição do índice do #39 e do boot)
SELECT to_regclass('public.clinicorp_monthly_summary') IS NOT NULL AS tem \gset
\if :tem
  SELECT count(*) > 0 AS rep, count(*) AS n FROM (SELECT 1 FROM clinicorp_monthly_summary
    GROUP BY tenant_id, source, period_month, business_id
   HAVING count(*) > 1 AND tenant_id IS NOT NULL AND business_id IS NOT NULL) x \gset
  \if :rep
    \echo '!!! [clinicorp-multi] resumo mensal: mês repetido na mesma clínica em' :n 'caso(s); chave global mantida.'
    \set falhou 1
  \else
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'idx_clinicorp_monthly_summary_tenant_period' AND NOT i.indisvalid) AS inval \gset
    \if :inval
      DROP INDEX CONCURRENTLY IF EXISTS idx_clinicorp_monthly_summary_tenant_period;
    \endif
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_clinicorp_monthly_summary_tenant_period
      ON clinicorp_monthly_summary (source, period_month, business_id, tenant_id);
    SELECT CASE WHEN con.oid IS NOT NULL THEN format('ALTER TABLE public.%I DROP CONSTRAINT %I', t.relname, con.conname)
                ELSE format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', ic.relname) END
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid
      LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype = 'u'
     WHERE t.relname = 'clinicorp_monthly_summary' AND t.relnamespace = 'public'::regnamespace
       AND i.indisunique AND NOT i.indisprimary AND ic.relname <> 'idx_clinicorp_monthly_summary_tenant_period'
       AND 0 <> ALL (i.indkey::int2[])
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int2[]) k
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['business_id', 'period_month', 'source']
       AND EXISTS (SELECT 1 FROM pg_index ni JOIN pg_class nc ON nc.oid = ni.indexrelid
                    WHERE nc.relname = 'idx_clinicorp_monthly_summary_tenant_period' AND ni.indisvalid) \gexec
  \endif
\endif

-- clinicorp_local_overrides (NULL = regra da plataforma; o índice trata NULL como um valor)
SELECT to_regclass('public.clinicorp_local_overrides') IS NOT NULL AS tem \gset
\if :tem
  SELECT count(*) > 0 AS rep, count(*) AS n FROM (SELECT 1 FROM clinicorp_local_overrides
    GROUP BY COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), scope_type, COALESCE(scope_id, '')
   HAVING count(*) > 1) x \gset
  \if :rep
    \echo '!!! [clinicorp-multi] overrides: escopo repetido em' :n 'caso(s); índice antigo mantido.'
    \set falhou 1
  \else
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_cc_overrides_tenant_scope' AND NOT i.indisvalid) AS inval \gset
    \if :inval
      DROP INDEX CONCURRENTLY IF EXISTS uq_cc_overrides_tenant_scope;
    \endif
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_cc_overrides_tenant_scope
      ON clinicorp_local_overrides ((COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)), scope_type, (COALESCE(scope_id, '')));
    SELECT EXISTS (SELECT 1 FROM pg_index ni JOIN pg_class nc ON nc.oid = ni.indexrelid
                    WHERE nc.relname = 'uq_cc_overrides_tenant_scope' AND ni.indisvalid) AS ok \gset
    \if :ok
      -- uniq_cc_overrides_scope é índice de expressão (não constraint): sai pelo nome.
      SELECT format('ALTER TABLE public.clinicorp_local_overrides DROP CONSTRAINT %I', conname)
        FROM pg_constraint WHERE conrelid = 'public.clinicorp_local_overrides'::regclass AND conname = 'uniq_cc_overrides_scope' \gexec
      DROP INDEX CONCURRENTLY IF EXISTS uniq_cc_overrides_scope;
    \endif
  \endif
\endif

-- pacientes / dentistas / agendamentos: id do Clinicorp único por clínica
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'clinicorp_patient_id') AS tem \gset
\if :tem
  SELECT count(*) > 0 AS rep, count(*) AS n FROM (SELECT 1 FROM pacientes WHERE clinicorp_patient_id IS NOT NULL
    GROUP BY tenant_id, clinicorp_patient_id HAVING count(*) > 1) x \gset
  \if :rep
    \echo '!!! [clinicorp-multi] pacientes: id do Clinicorp repetido na mesma clínica em' :n 'caso(s); chave global mantida.'
    \set falhou 1
  \else
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_pacientes_tenant_clinicorp' AND NOT i.indisvalid) AS inval \gset
    \if :inval
      DROP INDEX CONCURRENTLY IF EXISTS uq_pacientes_tenant_clinicorp;
    \endif
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_pacientes_tenant_clinicorp
      ON pacientes (tenant_id, clinicorp_patient_id) WHERE clinicorp_patient_id IS NOT NULL;
    SELECT CASE WHEN con.oid IS NOT NULL THEN format('ALTER TABLE public.%I DROP CONSTRAINT %I', t.relname, con.conname)
                ELSE format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', ic.relname) END
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid
      LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype = 'u'
     WHERE t.relname = 'pacientes' AND t.relnamespace = 'public'::regnamespace
       AND i.indisunique AND NOT i.indisprimary AND ic.relname <> 'uq_pacientes_tenant_clinicorp'
       AND 0 <> ALL (i.indkey::int2[])
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int2[]) k
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['clinicorp_patient_id']
       AND EXISTS (SELECT 1 FROM pg_index ni JOIN pg_class nc ON nc.oid = ni.indexrelid
                    WHERE nc.relname = 'uq_pacientes_tenant_clinicorp' AND ni.indisvalid) \gexec
  \endif
\endif

SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dentistas' AND column_name = 'clinicorp_professional_id') AS tem \gset
\if :tem
  SELECT count(*) > 0 AS rep, count(*) AS n FROM (SELECT 1 FROM dentistas WHERE clinicorp_professional_id IS NOT NULL
    GROUP BY tenant_id, clinicorp_professional_id HAVING count(*) > 1) x \gset
  \if :rep
    \echo '!!! [clinicorp-multi] dentistas: id do Clinicorp repetido na mesma clínica em' :n 'caso(s); chave global mantida.'
    \set falhou 1
  \else
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_dentistas_tenant_clinicorp' AND NOT i.indisvalid) AS inval \gset
    \if :inval
      DROP INDEX CONCURRENTLY IF EXISTS uq_dentistas_tenant_clinicorp;
    \endif
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_dentistas_tenant_clinicorp
      ON dentistas (tenant_id, clinicorp_professional_id) WHERE clinicorp_professional_id IS NOT NULL;
    SELECT CASE WHEN con.oid IS NOT NULL THEN format('ALTER TABLE public.%I DROP CONSTRAINT %I', t.relname, con.conname)
                ELSE format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', ic.relname) END
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid
      LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype = 'u'
     WHERE t.relname = 'dentistas' AND t.relnamespace = 'public'::regnamespace
       AND i.indisunique AND NOT i.indisprimary AND ic.relname <> 'uq_dentistas_tenant_clinicorp'
       AND 0 <> ALL (i.indkey::int2[])
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int2[]) k
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['clinicorp_professional_id']
       AND EXISTS (SELECT 1 FROM pg_index ni JOIN pg_class nc ON nc.oid = ni.indexrelid
                    WHERE nc.relname = 'uq_dentistas_tenant_clinicorp' AND ni.indisvalid) \gexec
  \endif
\endif

SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agendamentos' AND column_name = 'clinicorp_appointment_id') AS tem \gset
\if :tem
  SELECT count(*) > 0 AS rep, count(*) AS n FROM (SELECT 1 FROM agendamentos WHERE clinicorp_appointment_id IS NOT NULL
    GROUP BY tenant_id, clinicorp_appointment_id HAVING count(*) > 1) x \gset
  \if :rep
    \echo '!!! [clinicorp-multi] agendamentos: id do Clinicorp repetido na mesma clínica em' :n 'caso(s); chave global mantida.'
    \set falhou 1
  \else
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_agendamentos_tenant_clinicorp' AND NOT i.indisvalid) AS inval \gset
    \if :inval
      DROP INDEX CONCURRENTLY IF EXISTS uq_agendamentos_tenant_clinicorp;
    \endif
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_agendamentos_tenant_clinicorp
      ON agendamentos (tenant_id, clinicorp_appointment_id) WHERE clinicorp_appointment_id IS NOT NULL;
    SELECT CASE WHEN con.oid IS NOT NULL THEN format('ALTER TABLE public.%I DROP CONSTRAINT %I', t.relname, con.conname)
                ELSE format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', ic.relname) END
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid
      LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype = 'u'
     WHERE t.relname = 'agendamentos' AND t.relnamespace = 'public'::regnamespace
       AND i.indisunique AND NOT i.indisprimary AND ic.relname <> 'uq_agendamentos_tenant_clinicorp'
       AND 0 <> ALL (i.indkey::int2[])
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int2[]) k
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['clinicorp_appointment_id']
       AND EXISTS (SELECT 1 FROM pg_index ni JOIN pg_class nc ON nc.oid = ni.indexrelid
                    WHERE nc.relname = 'uq_agendamentos_tenant_clinicorp' AND ni.indisvalid) \gexec
  \endif
\endif

-- ─── 5. Espelhos clinicorp_*: o código faz ON CONFLICT (id, tenant_id). Só avisa (não altera PK).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.relname FROM pg_class t
     WHERE t.relnamespace = 'public'::regnamespace AND t.relkind = 'r'
       AND t.relname IN ('clinicorp_clinics', 'clinicorp_chairs', 'clinicorp_appointment_categories', 'clinicorp_specialties',
                         'clinicorp_appointments', 'clinicorp_evolutions', 'clinicorp_documents', 'clinicorp_estimates',
                         'clinicorp_patients', 'clinicorp_professionals')
       AND NOT EXISTS (
         SELECT 1 FROM pg_index i
          WHERE i.indrelid = t.oid AND i.indisunique AND i.indisvalid AND 0 <> ALL (i.indkey::int2[])
            AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest(i.indkey::int2[]) k
                   JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['id', 'tenant_id'])
  LOOP
    RAISE NOTICE '[clinicorp-multi] %: sem chave única (id, tenant_id); o upsert do espelho falha. Rodar migration-clinicorp-multitenant.sql', r.relname;
  END LOOP;
  FOR r IN
    SELECT t.relname FROM pg_class t JOIN pg_index i ON i.indrelid = t.oid AND i.indisprimary
     WHERE t.relnamespace = 'public'::regnamespace AND t.relname LIKE 'clinicorp\_%'
       AND (SELECT array_agg(a.attname::text) FROM unnest(i.indkey::int2[]) k
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['id']
       AND t.relname IN ('clinicorp_clinics', 'clinicorp_chairs', 'clinicorp_appointment_categories', 'clinicorp_specialties',
                         'clinicorp_appointments', 'clinicorp_evolutions', 'clinicorp_documents', 'clinicorp_estimates',
                         'clinicorp_patients', 'clinicorp_professionals')
  LOOP
    RAISE NOTICE '[clinicorp-multi] %: chave primária só em id (global): duas clínicas com o mesmo id do Clinicorp colidem. Revisar (backlog).', r.relname;
  END LOOP;
END $$;

\if :falhou
  \echo '!!! [clinicorp-multi] Há tabela pendente (repetido na mesma clínica). Revisar e rodar de novo.'
  SELECT 1/0 AS clinicorp_multi_clinica_pendente;
\endif
