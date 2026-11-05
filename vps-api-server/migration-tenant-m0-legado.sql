-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — M0 item 5: correção do Legado. SCRIPT MANUAL — NÃO entra no deploy.yml.
-- Autora: Renata (banco) · 2026-11-05
--
-- O quê: a migration-saas.sql (no deploy) põe os NULL de pacientes/agendamentos/financeiro/
-- tratamentos/dentistas na clínica placeholder 00000000-…-0001 (Legado), que o server.mjs
-- trata como inválida — a clínica dona deixa de ver esses registros. Aqui a filha volta para
-- a clínica do pai quando TODOS os registros do pai com aquela chave são de UMA clínica real.
--
-- Por que manual: troca o dono de dado de saúde entre clínicas. No deploy rodaria sozinha a
-- cada merge, sem ninguém olhar o que mudou. Aqui: dry-run primeiro, backup, aplicar, conferir.
--
-- Uso (na VPS, como postgres; precisa do migration-tenant-m0.sql já aplicado):
--   1. dry-run (padrão, só conta, nada muda):
--        sudo -u postgres psql -p 5433 -d odonto_db -f vps-api-server/migration-tenant-m0-legado.sql
--   2. backup:  sudo -u postgres pg_dump -p 5433 -Fc odonto_db > /root/backup-pre-m0-legado-$(date +%F).dump
--   3. aplicar: sudo -u postgres psql -p 5433 -d odonto_db -v aplicar=1 -f vps-api-server/migration-tenant-m0-legado.sql
--   Idempotente: rodar de novo só pega o que voltou ao Legado depois (ou o que estava segurado).
--
-- Agendamentos (lembrete de WhatsApp): processAppointmentReminders (server.mjs) lembra toda
-- consulta de amanhã de clínica real; processSolutionTriggers usa agendamentos de hoje a +2
-- dias, faltas de ontem/hoje e desmarcações das últimas 24 h. Para não disparar nada por causa
-- da troca, agendamento com data entre hoje-2 e hoje+2 (Brasília) ou alterado nas últimas 48 h
-- fica no Legado nesta rodada (sai numa próxima, quando sair da janela). Os de data mais
-- distante passam a aparecer na agenda da clínica e terão o lembrete normal da véspera.
--
-- Transações: cada regra é uma transação (auditoria + UPDATE), lock_timeout 5 s.
-- Rollback: docs/banco/rollback-tenant-m0.sql -v regra=legado (dry-run por padrão). Cada linha
-- trocada está em migracao.tenant_m0_auditoria (tabela, pk, tenant_antigo, tenant_novo, em).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\if :{?aplicar}
\else
  \set aplicar 0
\endif
SELECT set_config('m0.aplicar', CASE WHEN :'aplicar' = '1' THEN 'on' ELSE 'off' END, false) AS aplicar;

SET lock_timeout = '5s';
SELECT clock_timestamp() AS inicio \gset

DO $$
BEGIN
  IF to_regclass('migracao.tenant_m0_auditoria') IS NULL THEN
    RAISE EXCEPTION 'Rode migration-tenant-m0.sql antes (cria migracao.tenant_m0_auditoria).';
  END IF;
END $$;

-- ─── Função de preenchimento pelo pai (itens 4 e 5) ─────────────────────────
-- Copia a clínica do pai para a filha só quando todos os registros do pai com aquela chave
-- são da MESMA clínica real (pai no Legado não conta como clínica). Por padrão só mexe em
-- filha com tenant_id NULL; com corrige_legado = true, só na filha que está no Legado.
-- aplicar = false: só conta (dry-run, sem lock de linha). filtro: condição SQL extra sobre f.
-- Cada troca é gravada em migracao.tenant_m0_auditoria ANTES do UPDATE, na mesma transação;
-- o UPDATE só muda as linhas auditadas naquele lote. Filha sem chave primária de uma coluna
-- é pulada (não daria para desfazer).
-- (Mesma função em migration-tenant-m0.sql e migration-tenant-m0-legado.sql.)
CREATE OR REPLACE FUNCTION pg_temp.m0_preencher(filha TEXT, col_filha TEXT, pai TEXT, col_pai TEXT,
  corrige_legado BOOLEAN DEFAULT false, aplicar BOOLEAN DEFAULT true, filtro TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  n BIGINT;
  legado CONSTANT TEXT := '00000000-0000-0000-0000-000000000001';
  regra TEXT := CASE WHEN corrige_legado THEN 'legado' ELSE 'preencher' END || ':' || pai || '.' || col_pai;
  pk_col TEXT;
  pk_tipo TEXT;
  origem TEXT;
BEGIN
  IF to_regclass(format('public.%I', filha)) IS NULL OR to_regclass(format('public.%I', pai)) IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=filha AND column_name=col_filha)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=filha AND column_name='tenant_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=pai AND column_name=col_pai)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=pai AND column_name='tenant_id') THEN
    RETURN;
  END IF;
  SELECT min(a.attname), min(format_type(a.atttypid, a.atttypmod))
    INTO pk_col, pk_tipo
    FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid = format('public.%I', filha)::regclass AND i.indisprimary
  HAVING count(*) = 1;
  IF pk_col IS NULL THEN
    RAISE NOTICE '[M0 %] %: sem chave primária de uma coluna, pulada', regra, filha;
    RETURN;
  END IF;

  -- Linhas candidatas: f = filha, p = clínica única (real) do pai.
  origem := format(
    'FROM public.%1$I f
       JOIN (SELECT %4$I::text AS chave, (array_agg(DISTINCT tenant_id::text))[1]::uuid AS tenant_id
               FROM public.%3$I
              WHERE %4$I IS NOT NULL AND tenant_id IS NOT NULL
              GROUP BY %4$I::text
             HAVING count(DISTINCT tenant_id) = 1
                AND (array_agg(DISTINCT tenant_id::text))[1] <> %5$L) p
         ON p.chave = f.%2$I::text
      WHERE %6$s
        AND f.%2$I IS NOT NULL
        AND (%7$s)',
    filha, col_filha, pai, col_pai, legado,
    CASE WHEN corrige_legado THEN format('f.tenant_id::text = %L', legado) ELSE 'f.tenant_id IS NULL' END,
    COALESCE(filtro, 'true'));

  IF NOT aplicar THEN
    EXECUTE 'SELECT count(*) ' || origem INTO n;
    IF n > 0 THEN
      RAISE NOTICE '[M0 dry-run %] %: % linha(s) iriam para a clínica de %.%', regra, filha, n, pai, col_pai;
    END IF;
    RETURN;
  END IF;

  EXECUTE format(
    'INSERT INTO migracao.tenant_m0_auditoria (lote, regra, tabela, pk, tenant_antigo, tenant_novo)
     SELECT txid_current(), %1$L, %2$L, f.%3$I::text, f.tenant_id, p.tenant_id %4$s
        FOR UPDATE OF f', regra, filha, pk_col, origem);
  EXECUTE format(
    'UPDATE public.%1$I f SET tenant_id = a.tenant_novo
       FROM migracao.tenant_m0_auditoria a
      WHERE a.lote = txid_current() AND a.tabela = %2$L AND a.regra = %3$L
        AND f.%4$I = a.pk::%5$s',
    filha, filha, regra, pk_col, pk_tipo);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '[M0 %] %: % linha(s) com a clínica de %.% (auditadas, lote %)',
      regra, filha, n, pai, col_pai, txid_current();
  END IF;
END $$ LANGUAGE plpgsql;

-- Janela que não pode gerar lembrete/gatilho de WhatsApp (ver cabeçalho).
\set filtro_agenda 'NOT (f.data BETWEEN (NOW() AT TIME ZONE ''America/Sao_Paulo'')::date - 2 AND (NOW() AT TIME ZONE ''America/Sao_Paulo'')::date + 2) AND COALESCE(f.updated_at, f.created_at, ''-infinity''::timestamptz) < NOW() - INTERVAL ''48 hours'''

-- Agendamentos segurados nesta rodada (só informa).
DO $$
DECLARE n BIGINT;
BEGIN
  IF to_regclass('public.agendamentos') IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO n FROM agendamentos f
   WHERE f.tenant_id::text = '00000000-0000-0000-0000-000000000001'
     AND NOT (f.data IS NOT NULL
              AND NOT (f.data BETWEEN (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 2 AND (NOW() AT TIME ZONE 'America/Sao_Paulo')::date + 2)
              AND COALESCE(f.updated_at, f.created_at, '-infinity'::timestamptz) < NOW() - INTERVAL '48 hours');
  IF n > 0 THEN
    RAISE NOTICE '[M0 legado] agendamentos: % no Legado ficam para outra rodada (data perto de hoje ou alterados em 48 h)', n;
  END IF;
END $$;

-- Pais primeiro. Pacientes no Legado sem pai continuam lá (revisão com a clínica).
SELECT pg_temp.m0_preencher('agendamentos',           'paciente_id',   'pacientes',    'id', true, current_setting('m0.aplicar')::boolean, :'filtro_agenda');
SELECT pg_temp.m0_preencher('financeiro',             'paciente_id',   'pacientes',    'id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('tratamentos',            'paciente_id',   'pacientes',    'id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('dentistas',              'id',            'agendamentos', 'dentista_id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('tratamento_etapas',      'tratamento_id', 'tratamentos',  'id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('comissoes',              'tratamento_id', 'tratamentos',  'id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('procedimento_execucoes', 'paciente_id',   'pacientes',    'id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('prontuarios',            'paciente_id',   'pacientes',    'id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('anamneses',              'paciente_id',   'pacientes',    'id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('odontogramas',           'paciente_id',   'pacientes',    'id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('orcamentos',             'paciente_id',   'pacientes',    'id', true, current_setting('m0.aplicar')::boolean);
SELECT pg_temp.m0_preencher('user_roles',             'user_id',       'profiles',     'id', true, current_setting('m0.aplicar')::boolean);

-- Resumo
\if :aplicar
SELECT tabela, count(*) AS linhas, min(em) AS de, max(em) AS ate
  FROM migracao.tenant_m0_auditoria
 WHERE regra LIKE 'legado:%' AND em >= :'inicio'
 GROUP BY tabela ORDER BY tabela;
\else
\echo 'DRY-RUN: nada foi alterado. Para aplicar: -v aplicar=1 (depois do backup).'
\endif
