-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — CPF único POR CLÍNICA (antes: UNIQUE global em pacientes.cpf).
-- Autora: Renata (banco) · 2026-11-05 · Idempotente: pode rodar N vezes.
--
-- Por quê: pacientes_cpf_key (migration.sql) vale para o banco inteiro. Cadastrar na clínica A
-- um CPF que já é paciente da clínica B dava erro, ou seja, A descobria que a pessoa é paciente de
-- B (dado de saúde, LGPD art. 11), e a mesma pessoa não podia ser paciente de duas clínicas.
--
-- O que faz, nesta ordem (a antiga só sai depois que a nova está VÁLIDA):
--   1. checa se já há CPF repetido DENTRO da mesma clínica (comparando só os dígitos). Se houver,
--      não muda nada e avisa (sem mostrar CPF): é preciso revisar com a clínica antes;
--   2. CREATE UNIQUE INDEX CONCURRENTLY uq_pacientes_tenant_cpf (tenant_id, só dígitos do cpf)
--      WHERE cpf tem dígito. CONCURRENTLY não trava escrita; roda fora de transação (este arquivo
--      não usa BEGIN). Índice inválido de tentativa anterior é apagado e refeito;
--   3. só com o índice novo válido: ALTER TABLE pacientes DROP CONSTRAINT IF EXISTS pacientes_cpf_key.
-- Não altera nenhum CPF gravado. A normalização (só dígitos) é feita pelo backend na gravação.
-- lock_timeout de 5 s: sem o lock, falha, nada fica pela metade (no máximo um índice inválido,
-- que a próxima rodada refaz) e o deploy mostra o alerta.
--
-- Revisão de CPF repetido na mesma clínica (mostra ids, não CPF; rodar à mão se o passo 1 avisar):
--   SELECT tenant_id, array_agg(id ORDER BY created_at) FROM pacientes
--    WHERE regexp_replace(COALESCE(cpf,''), '\D', '', 'g') <> ''
--    GROUP BY tenant_id, regexp_replace(cpf, '\D', '', 'g') HAVING count(*) > 1;
--
-- Rollback (só se voltar o código antigo; falha se já houver o mesmo CPF em duas clínicas):
--   ALTER TABLE pacientes ADD CONSTRAINT pacientes_cpf_key UNIQUE (cpf);
--   DROP INDEX CONCURRENTLY IF EXISTS uq_pacientes_tenant_cpf;
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

SELECT to_regclass('public.pacientes') IS NOT NULL
   AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'cpf')
   AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'tenant_id')
       AS tem_tabela \gset

\if :tem_tabela

-- 1. CPF repetido dentro da mesma clínica (só a contagem; nunca o CPF)
SELECT count(*) > 0 AS tem_repetidos, count(*) AS repetidos FROM (
  SELECT 1 FROM pacientes
   WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') <> ''
   GROUP BY tenant_id, regexp_replace(cpf, '\D', '', 'g')
  HAVING count(*) > 1) x \gset

\if :tem_repetidos
  \echo '!!! [cpf-por-clinica] Há CPF repetido dentro da mesma clínica:' :repetidos 'caso(s). Nada foi alterado.'
  \echo '!!! Revisar com a clínica (consulta de revisão no cabeçalho deste arquivo) e rodar de novo.'
  SELECT 1/0 AS cpf_repetido_na_clinica;   -- falha controlada: o deploy mostra o ::warning
\endif

-- 2. Índice novo. Inválido (tentativa anterior interrompida) é refeito.
SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = 'uq_pacientes_tenant_cpf' AND NOT i.indisvalid) AS indice_invalido \gset
\if :indice_invalido
  DROP INDEX CONCURRENTLY IF EXISTS uq_pacientes_tenant_cpf;
\endif
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_pacientes_tenant_cpf
  ON pacientes (tenant_id, (regexp_replace(cpf, '\D', '', 'g')))
  WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') <> '';

-- 3. Só remove a antiga se a nova existe e está válida.
SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = 'uq_pacientes_tenant_cpf' AND i.indisvalid AND i.indisready) AS indice_ok \gset
\if :indice_ok
  ALTER TABLE pacientes DROP CONSTRAINT IF EXISTS pacientes_cpf_key;
  \echo '[cpf-por-clinica] CPF único por clínica ativo; chave global removida.'
\else
  \echo '!!! [cpf-por-clinica] Índice por clínica não ficou válido: chave global mantida.'
  SELECT 1/0 AS indice_por_clinica_invalido;
\endif

\else
  \echo '[cpf-por-clinica] pacientes.cpf/tenant_id ausente: nada a fazer.'
\endif
