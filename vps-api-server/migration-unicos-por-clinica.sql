-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — chaves únicas POR CLÍNICA no lugar das globais.
-- Autora: Renata (banco) · 2026-11-05 · Idempotente: pode rodar N vezes.
--
-- Por quê: estas UNIQUE valiam para o banco inteiro. Cadastrar na clínica A um valor que já
-- existia na clínica B dava erro com o nome da constraint: A descobria cadastro de B (paciente é
-- dado de saúde, LGPD art. 11), e a mesma pessoa/nome não podia existir em duas clínicas.
--   pacientes_cpf_key           UNIQUE (cpf)  → uq_pacientes_tenant_cpf      (tenant_id, só dígitos do cpf)
--   dentistas_cro_key           UNIQUE (cro)  → uq_dentistas_tenant_cro      (tenant_id, CRO só letras/dígitos, maiúsculo)
--   agenda_marcadores_nome_key  UNIQUE (nome) → uq_agenda_marcadores_tenant_nome (tenant_id, lower(trim(nome)))
--
-- Cada troca é independente e segue a mesma ordem (a antiga só sai com a nova VÁLIDA):
--   1. conta repetidos DENTRO da mesma clínica com a regra nova (só a contagem, nunca o valor).
--      Havendo, não mexe naquela tabela, avisa e segue para a próxima; no fim, falha (o deploy
--      mostra o ::warning);
--   2. CREATE UNIQUE INDEX CONCURRENTLY (não trava escrita; por isso este arquivo não usa BEGIN).
--      Índice inválido de tentativa anterior é apagado e refeito;
--   3. ALTER TABLE ... DROP CONSTRAINT IF EXISTS <global>.
-- Não altera nenhum valor gravado (a normalização do CPF é feita pelo backend ao gravar).
-- lock_timeout de 5 s: sem o lock, falha; no máximo fica um índice inválido, refeito na próxima.
--
-- Revisão de repetidos na mesma clínica (mostra ids, não o valor; rodar à mão se o passo 1 avisar):
--   SELECT tenant_id, array_agg(id) FROM pacientes WHERE regexp_replace(COALESCE(cpf,''), '\D', '', 'g') <> ''
--    GROUP BY tenant_id, regexp_replace(cpf, '\D', '', 'g') HAVING count(*) > 1;
--   SELECT tenant_id, array_agg(id) FROM dentistas WHERE regexp_replace(COALESCE(cro,''), '[^0-9A-Za-z]', '', 'g') <> ''
--    GROUP BY tenant_id, upper(regexp_replace(cro, '[^0-9A-Za-z]', '', 'g')) HAVING count(*) > 1;
--   SELECT tenant_id, array_agg(id) FROM agenda_marcadores GROUP BY tenant_id, lower(trim(nome)) HAVING count(*) > 1;
--
-- Rollback (só se voltar o código antigo; falha se o mesmo valor já existir em duas clínicas):
--   ALTER TABLE pacientes ADD CONSTRAINT pacientes_cpf_key UNIQUE (cpf);
--   ALTER TABLE dentistas ADD CONSTRAINT dentistas_cro_key UNIQUE (cro);
--   ALTER TABLE agenda_marcadores ADD CONSTRAINT agenda_marcadores_nome_key UNIQUE (nome);
--   DROP INDEX CONCURRENTLY IF EXISTS uq_pacientes_tenant_cpf;   (idem para os outros dois)
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET lock_timeout = '5s';
\set falhou 0

-- ─── pacientes.cpf ──────────────────────────────────────────────────────────
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'cpf')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'tenant_id')
       AS tem_tabela \gset
\if :tem_tabela
  SELECT count(*) > 0 AS tem_repetidos, count(*) AS repetidos FROM (
    SELECT 1 FROM pacientes WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') <> ''
     GROUP BY tenant_id, regexp_replace(cpf, '\D', '', 'g') HAVING count(*) > 1) x \gset
  \if :tem_repetidos
    \echo '!!! [unicos-por-clinica] pacientes: CPF repetido na mesma clínica em' :repetidos 'caso(s). Chave global mantida.'
    \set falhou 1
  \else
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_pacientes_tenant_cpf' AND NOT i.indisvalid) AS invalido \gset
    \if :invalido
      DROP INDEX CONCURRENTLY IF EXISTS uq_pacientes_tenant_cpf;
    \endif
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_pacientes_tenant_cpf
      ON pacientes (tenant_id, (regexp_replace(cpf, '\D', '', 'g')))
      WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') <> '';
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_pacientes_tenant_cpf' AND i.indisvalid AND i.indisready) AS ok \gset
    \if :ok
      ALTER TABLE pacientes DROP CONSTRAINT IF EXISTS pacientes_cpf_key;
      \echo '[unicos-por-clinica] pacientes: CPF único por clínica ativo.'
    \else
      \echo '!!! [unicos-por-clinica] pacientes: índice por clínica inválido; chave global mantida.'
      \set falhou 1
    \endif
  \endif
\endif

-- ─── dentistas.cro ──────────────────────────────────────────────────────────
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dentistas' AND column_name = 'cro')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dentistas' AND column_name = 'tenant_id')
       AS tem_tabela \gset
\if :tem_tabela
  SELECT count(*) > 0 AS tem_repetidos, count(*) AS repetidos FROM (
    SELECT 1 FROM dentistas WHERE regexp_replace(COALESCE(cro, ''), '[^0-9A-Za-z]', '', 'g') <> ''
     GROUP BY tenant_id, upper(regexp_replace(cro, '[^0-9A-Za-z]', '', 'g')) HAVING count(*) > 1) x \gset
  \if :tem_repetidos
    \echo '!!! [unicos-por-clinica] dentistas: CRO repetido na mesma clínica em' :repetidos 'caso(s). Chave global mantida.'
    \set falhou 1
  \else
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_dentistas_tenant_cro' AND NOT i.indisvalid) AS invalido \gset
    \if :invalido
      DROP INDEX CONCURRENTLY IF EXISTS uq_dentistas_tenant_cro;
    \endif
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_dentistas_tenant_cro
      ON dentistas (tenant_id, (upper(regexp_replace(cro, '[^0-9A-Za-z]', '', 'g'))))
      WHERE regexp_replace(COALESCE(cro, ''), '[^0-9A-Za-z]', '', 'g') <> '';
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_dentistas_tenant_cro' AND i.indisvalid AND i.indisready) AS ok \gset
    \if :ok
      ALTER TABLE dentistas DROP CONSTRAINT IF EXISTS dentistas_cro_key;
      \echo '[unicos-por-clinica] dentistas: CRO único por clínica ativo.'
    \else
      \echo '!!! [unicos-por-clinica] dentistas: índice por clínica inválido; chave global mantida.'
      \set falhou 1
    \endif
  \endif
\endif

-- ─── agenda_marcadores.nome ─────────────────────────────────────────────────
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agenda_marcadores' AND column_name = 'nome')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agenda_marcadores' AND column_name = 'tenant_id')
       AS tem_tabela \gset
\if :tem_tabela
  SELECT count(*) > 0 AS tem_repetidos, count(*) AS repetidos FROM (
    SELECT 1 FROM agenda_marcadores GROUP BY tenant_id, lower(trim(nome)) HAVING count(*) > 1) x \gset
  \if :tem_repetidos
    \echo '!!! [unicos-por-clinica] agenda_marcadores: nome repetido na mesma clínica em' :repetidos 'caso(s). Chave global mantida.'
    \set falhou 1
  \else
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_agenda_marcadores_tenant_nome' AND NOT i.indisvalid) AS invalido \gset
    \if :invalido
      DROP INDEX CONCURRENTLY IF EXISTS uq_agenda_marcadores_tenant_nome;
    \endif
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_agenda_marcadores_tenant_nome
      ON agenda_marcadores (tenant_id, (lower(trim(nome))));
    SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_agenda_marcadores_tenant_nome' AND i.indisvalid AND i.indisready) AS ok \gset
    \if :ok
      ALTER TABLE agenda_marcadores DROP CONSTRAINT IF EXISTS agenda_marcadores_nome_key;
      \echo '[unicos-por-clinica] agenda_marcadores: nome único por clínica ativo.'
    \else
      \echo '!!! [unicos-por-clinica] agenda_marcadores: índice por clínica inválido; chave global mantida.'
      \set falhou 1
    \endif
  \endif
\endif

-- Falha controlada no fim, para o deploy mostrar o ::warning (o que deu certo já ficou).
\if :falhou
  \echo '!!! [unicos-por-clinica] Revisar repetidos com a clínica (consultas no cabeçalho) e rodar de novo.'
  SELECT 1/0 AS unicos_por_clinica_pendente;
\endif
