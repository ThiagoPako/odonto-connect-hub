-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — desfaz as trocas de tenant_id do M0 (itens 4 e 5) pela auditoria.
-- Autora: Renata (banco) · 2026-11-05 · MANUAL, não entra no deploy.yml.
--
-- Volta cada linha de migracao.tenant_m0_auditoria ainda não desfeita ao tenant_antigo,
-- SÓ se a linha ainda está no tenant_novo (se a clínica mexeu depois, não sobrescreve e
-- informa). Marca desfeito_em. Uma transação por tabela, lock_timeout 5 s.
--
-- Uso (na VPS, como postgres):
--   dry-run (padrão):  sudo -u postgres psql -p 5433 -d odonto_db -f docs/banco/rollback-tenant-m0.sql
--   só o Legado:       ... -v regra=legado -f docs/banco/rollback-tenant-m0.sql
--   só o item 4:       ... -v regra=preencher -f ...
--   a partir de:       ... -v desde='2026-11-05 10:00-03' -f ...
--   aplicar:           ... -v aplicar=1 [-v regra=...] [-v desde=...] -f ...
-- Atenção: linha devolvida ao NULL volta ao Legado no próximo deploy (migration-saas.sql) nas
-- tabelas que ela cobre; para manter o Legado, desfaça com regra=legado.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\if :{?aplicar}
\else
  \set aplicar 0
\endif
\if :{?regra}
\else
  \set regra ''
\endif
\if :{?desde}
\else
  \set desde '-infinity'
\endif
SELECT set_config('m0.aplicar', CASE WHEN :'aplicar' = '1' THEN 'on' ELSE 'off' END, false) AS aplicar,
       set_config('m0.regra', :'regra', false) AS regra,
       set_config('m0.desde', :'desde', false) AS desde;

SET lock_timeout = '5s';

DO $$
DECLARE
  aplicar BOOLEAN := current_setting('m0.aplicar')::boolean;
  regra_f TEXT := NULLIF(current_setting('m0.regra'), '');
  desde TIMESTAMPTZ := current_setting('m0.desde')::timestamptz;
  t TEXT; pk_col TEXT; pk_tipo TEXT; n BIGINT; total BIGINT; filtro TEXT;
BEGIN
  IF to_regclass('migracao.tenant_m0_auditoria') IS NULL THEN
    RAISE NOTICE '[M0 rollback] nada a desfazer (sem auditoria)';
    RETURN;
  END IF;
  filtro := format('a.desfeito_em IS NULL AND a.em >= %L AND (%L IS NULL OR a.regra LIKE %L || '':%%'')',
                   desde, regra_f, regra_f);
  FOR t IN EXECUTE 'SELECT DISTINCT a.tabela FROM migracao.tenant_m0_auditoria a WHERE ' || filtro || ' ORDER BY 1' LOOP
    SELECT min(a.attname), min(format_type(a.atttypid, a.atttypmod)) INTO pk_col, pk_tipo
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = format('public.%I', t)::regclass AND i.indisprimary
    HAVING count(*) = 1;
    EXECUTE format('SELECT count(*) FROM migracao.tenant_m0_auditoria a WHERE a.tabela = %L AND ', t) || filtro INTO total;
    -- Mais recente primeiro: se a mesma linha foi trocada 2×, volta passo a passo.
    IF NOT aplicar THEN
      EXECUTE format(
        'SELECT count(*) FROM migracao.tenant_m0_auditoria a JOIN public.%1$I f ON f.%2$I = a.pk::%3$s
          WHERE a.tabela = %4$L AND f.tenant_id = a.tenant_novo AND ', t, pk_col, pk_tipo, t) || filtro INTO n;
      RAISE NOTICE '[M0 rollback dry-run] %: % de % linha(s) voltariam (o resto foi alterado depois)', t, n, total;
      CONTINUE;
    END IF;
    EXECUTE format(
      'WITH alvo AS (
         SELECT DISTINCT ON (a.pk) a.id, a.pk, a.tenant_antigo, a.tenant_novo
           FROM migracao.tenant_m0_auditoria a
          WHERE a.tabela = %1$L AND %4$s
          ORDER BY a.pk, a.id DESC),
       volta AS (
         UPDATE public.%1$I f SET tenant_id = alvo.tenant_antigo
           FROM alvo WHERE f.%2$I = alvo.pk::%3$s AND f.tenant_id = alvo.tenant_novo
         RETURNING alvo.id)
       UPDATE migracao.tenant_m0_auditoria a SET desfeito_em = NOW() FROM volta WHERE a.id = volta.id',
      t, pk_col, pk_tipo, filtro);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '[M0 rollback] %: % de % linha(s) voltaram (o resto foi alterado depois e ficou)', t, n, total;
    COMMIT;
  END LOOP;
END $$;
