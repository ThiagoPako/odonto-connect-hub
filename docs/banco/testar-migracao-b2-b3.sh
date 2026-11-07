#!/usr/bin/env bash
# Teste da vps-api-server/migration-schema-b2-b3.sql num Postgres TEMPORÁRIO (initdb numa pasta
# temporária, porta livre, apagado no fim). Nunca conecta em outro banco.
#
# Dois cenários, cada um roda a migração 2× (a 2ª não pode dar erro nem mudar nada):
#   novo   — banco montado só com as migrações do deploy + o CREATE de orcamentos do boot
#            (sem procedimentos_catalogo, reactivation_* sem tenant_id): o caso do QA.
#   antigo — procedimentos_catalogo/_versoes já existem com menos colunas, linhas sem
#            tenant_id e tabelas com o postgres como dono (como em produção).
# Depois roda os INSERT/UPDATE/SELECT reais das rotas (copiados do server.mjs) como a API.
#
# Uso: docs/banco/testar-migracao-b2-b3.sh   (precisa de initdb/pg_ctl/psql no PATH ou PGBIN)
set -euo pipefail
export LC_ALL=C LANG=C

AQUI="$(cd "$(dirname "$0")" && pwd)"
M="$AQUI/../../vps-api-server"
MIG="$M/migration-schema-b2-b3.sql"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb 2>/dev/null || echo /opt/homebrew/opt/postgresql@16/bin/initdb)")}"
TMP="$(mktemp -d)"
PORT="${PORT:-$(( 56000 + RANDOM % 2000 ))}"
LOG="$TMP/log"

parar() { "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap parar EXIT

"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/pg.log" -w start >/dev/null

ps_() { "$PGBIN/psql" -h "$TMP" -p "$PORT" -U "${PSU:-postgres}" -X -q -v ON_ERROR_STOP=1 "$@"; }
falhas=0
ok()   { echo "  ok   $1"; }
erro() { echo "  FALHA $1"; falhas=$((falhas + 1)); }
checa() { # checa <db> <descrição> <sql que devolve 't'>
  local r; r="$(ps_ -d "$1" -tA -c "$3" 2>&1 || true)"
  [ "$r" = "t" ] && ok "$2" || erro "$2 (veio: $r)"
}
roda_mig() { # roda_mig <db> <rodada>
  if ps_ -d "$1" -f "$MIG" >"$LOG.$1.$2" 2>&1; then
    if grep -q "ERROR" "$LOG.$1.$2"; then erro "migração $2ª vez em $1 (ERROR no log)"; cat "$LOG.$1.$2"; else ok "migração $2ª vez em $1 sem erro"; fi
  else
    erro "migração $2ª vez em $1"; cat "$LOG.$1.$2"
  fi
}
foto() { ps_ -d "$1" -tA -c "
  select string_agg(table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,''), ',' order by table_name, column_name)
    from information_schema.columns where table_schema='public'
     and table_name in ('orcamentos','procedimentos_catalogo','procedimentos_catalogo_versoes','reactivation_rules','reactivation_sends')
  union all select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname='public'
  union all select string_agg(tgname, ',' order by tgname) from pg_trigger where not tgisinternal
  union all select string_agg(tablename||':'||tableowner||':'||rowsecurity, ',' order by tablename) from pg_tables where schemaname='public'
  union all select string_agg(tablename||':'||policyname, ',' order by tablename, policyname) from pg_policies"; }

ps_ -d postgres -c "CREATE ROLE odonto_user LOGIN" -c "CREATE ROLE odonto_app LOGIN"

base() { # base <db>: o que o deploy cria antes deste arquivo (ordem do deploy.yml)
  ps_ -d postgres -c "CREATE DATABASE $1"
  ps_ -d "$1" -c "GRANT CREATE, USAGE ON SCHEMA public TO odonto_user, odonto_app"
  for f in migration.sql migration-reativacao.sql migration-saas.sql migration-tenant-defaults.sql; do
    ps_ -d "$1" -f "$M/$f" >"$LOG.base.$1.$f" 2>&1 || { echo "base: $f falhou"; cat "$LOG.base.$1.$f"; exit 1; }
  done
  # is_super_admin() (migration-rls-enforcement.sql, rodada à mão em produção)
  ps_ -d "$1" -c "CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS \$\$ SELECT coalesce(current_setting('app.is_super_admin', true), '') = 'true' \$\$"
  # Tabelas da API: dono odonto_user (premissa da auditoria: a API criou pelo boot). tenants e
  # reactivation_* ficam com o postgres (criadas pelo deploy), como em produção.
  ps_ -d "$1" -c "DO \$\$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('tenants','reactivation_rules','reactivation_sends') LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO odonto_user', r.tablename); END LOOP; END \$\$" \
              -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO odonto_app"
  ps_ -d "$1" -c "INSERT INTO tenants (id, nome, slug) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','Clínica A','a'), ('bbbbbbbb-0000-0000-0000-00000000000b','Clínica B','b') ON CONFLICT DO NOTHING" >/dev/null
}

echo "== cenário novo"
base novo
checa novo "antes: reactivation_rules sem tenant_id" "select not exists (select 1 from information_schema.columns where table_name='reactivation_rules' and column_name='tenant_id')"
checa novo "antes: orcamentos sem titulo/print_config/odontograma_snapshot e sem procedimentos_catalogo_versoes" \
  "select not exists (select 1 from information_schema.columns where table_name='orcamentos' and column_name in ('titulo','print_config','odontograma_snapshot')) and to_regclass('public.procedimentos_catalogo_versoes') is null"
roda_mig novo 1; F1="$(foto novo)"
roda_mig novo 2; F2="$(foto novo)"
[ "$F1" = "$F2" ] && ok "2ª rodada não muda o schema" || { erro "2ª rodada mudou o schema"; diff <(echo "$F1" | tr ',' '\n') <(echo "$F2" | tr ',' '\n') || true; }

echo "== cenário antigo"
base antigo
ps_ -d antigo <<'SQL'
-- catálogo antigo, criado fora do repositório, sem versao_atual/requer_face; versões sem tenant_id
CREATE TABLE procedimentos_catalogo (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID, nome TEXT NOT NULL, valor_particular NUMERIC(12,2), ativo BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE procedimentos_catalogo_versoes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), procedimento_id UUID NOT NULL, versao INTEGER NOT NULL, nome TEXT, valido_desde TIMESTAMPTZ DEFAULT NOW(), valido_ate TIMESTAMPTZ);
INSERT INTO procedimentos_catalogo (id, tenant_id, nome) VALUES ('cccccccc-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Limpeza');
INSERT INTO procedimentos_catalogo_versoes (procedimento_id, versao, nome) VALUES ('cccccccc-0000-0000-0000-00000000000c', 1, 'Limpeza');
-- reativação já com tenant_id (como a schema-alinhamento deixa) mas linhas NULL
ALTER TABLE reactivation_rules ADD COLUMN tenant_id UUID;
ALTER TABLE reactivation_sends ADD COLUMN tenant_id UUID;
INSERT INTO profiles (id, name, email, tenant_id) VALUES ('dddddddd-0000-0000-0000-00000000000d', 'Ana', 'ana@a.test', 'aaaaaaaa-0000-0000-0000-00000000000a');
INSERT INTO reactivation_rules (id, name, message_template, created_by) VALUES ('eeeeeeee-0000-0000-0000-00000000000e', 'Inativos', 'Oi {nome}', 'dddddddd-0000-0000-0000-00000000000d');
INSERT INTO reactivation_rules (id, name, message_template) VALUES ('ffffffff-0000-0000-0000-00000000000f', 'Sem autor', 'Oi');
INSERT INTO reactivation_sends (rule_id, phone, message) VALUES ('eeeeeeee-0000-0000-0000-00000000000e', '5511999990000', 'Oi');
ALTER TABLE reactivation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactivation_sends ENABLE ROW LEVEL SECURITY;
-- catálogo antigo é da API (está na lista da migration-tenant-defaults.sql)
ALTER TABLE procedimentos_catalogo OWNER TO odonto_user;
ALTER TABLE procedimentos_catalogo_versoes OWNER TO odonto_user;
SQL
roda_mig antigo 1; F1="$(foto antigo)"
roda_mig antigo 2; F2="$(foto antigo)"
[ "$F1" = "$F2" ] && ok "2ª rodada não muda o schema" || { erro "2ª rodada mudou o schema"; diff <(echo "$F1" | tr ',' '\n') <(echo "$F2" | tr ',' '\n') || true; }
checa antigo "dados antigos mantidos (1 procedimento, 1 versão, 2 regras, 1 envio)" \
  "select (select count(*) from procedimentos_catalogo)=1 and (select count(*) from procedimentos_catalogo_versoes)=1 and (select count(*) from reactivation_rules)=2 and (select count(*) from reactivation_sends)=1"
checa antigo "versão antiga ganhou o tenant do procedimento" \
  "select tenant_id='aaaaaaaa-0000-0000-0000-00000000000a' from procedimentos_catalogo_versoes"
checa antigo "regra antiga ganhou o tenant do autor; regra sem autor continua NULL" \
  "select (select tenant_id from reactivation_rules where id='eeeeeeee-0000-0000-0000-00000000000e')='aaaaaaaa-0000-0000-0000-00000000000a' and (select tenant_id from reactivation_rules where id='ffffffff-0000-0000-0000-00000000000f') is null"
checa antigo "envio antigo ganhou o tenant da regra" "select tenant_id='aaaaaaaa-0000-0000-0000-00000000000a' from reactivation_sends"
checa antigo "catálogo antigo mantém o dono e não ganha RLS/política" \
  "select (select tableowner from pg_tables where tablename='procedimentos_catalogo')='odonto_user' and not (select rowsecurity from pg_tables where tablename='procedimentos_catalogo') and not exists (select 1 from pg_policies where tablename='procedimentos_catalogo')"

for db in novo antigo; do
  echo "== rotas reais como a API ($db)"
  checa "$db" "reactivation_* passam para o dono de pacientes" \
    "select bool_and(tableowner='odonto_user') from pg_tables where tablename in ('reactivation_rules','reactivation_sends')"
  # Como a API (odonto_user = dono), com contexto da clínica A — SQL copiado do server.mjs
  if ps_ -d "$db" -U odonto_user >"$LOG.rotas.$db" 2>&1 <<'SQL'
BEGIN;
SELECT set_config('app.tenant_id', 'aaaaaaaa-0000-0000-0000-00000000000a', true);
-- POST /api/procedimentos-catalogo
INSERT INTO procedimentos_catalogo
  (id, codigo, nome, categoria, valor_particular, valor_convenio, duracao_minutos, cor, requer_dente, requer_face, descricao, versao_atual, tenant_id)
VALUES ('11111111-0000-0000-0000-000000000001', 'P1', 'Restauração', 'Dentística', 200, 150, 30, '#0d9488', true, false, null, 1, 'aaaaaaaa-0000-0000-0000-00000000000a');
-- criarVersaoProcedimento
UPDATE procedimentos_catalogo_versoes SET valido_ate = NOW() WHERE procedimento_id = '11111111-0000-0000-0000-000000000001' AND valido_ate IS NULL;
SELECT COALESCE(MAX(versao), 0) AS m FROM procedimentos_catalogo_versoes WHERE procedimento_id='11111111-0000-0000-0000-000000000001';
INSERT INTO procedimentos_catalogo_versoes
  (id, procedimento_id, versao, codigo, nome, categoria, valor_particular, valor_convenio, duracao_minutos, cor, requer_dente, requer_face, descricao, motivo, alterado_por)
VALUES (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', 1, 'P1', 'Restauração', 'Dentística', 200, 150, 30, '#0d9488', true, false, null, 'criação', null);
UPDATE procedimentos_catalogo SET versao_atual=1 WHERE id='11111111-0000-0000-0000-000000000001';
-- congelarVersoesItens
SELECT v.id, v.versao FROM procedimentos_catalogo_versoes v
  JOIN procedimentos_catalogo pc ON pc.id = v.procedimento_id AND pc.tenant_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
 WHERE v.procedimento_id='11111111-0000-0000-0000-000000000001' AND v.valido_ate IS NULL ORDER BY v.versao DESC LIMIT 1;
-- GET /api/procedimentos-catalogo/:id/versao-em
SELECT * FROM procedimentos_catalogo_versoes WHERE procedimento_id='11111111-0000-0000-0000-000000000001'
   AND valido_desde <= NOW() AND (valido_ate IS NULL OR valido_ate > NOW()) ORDER BY versao DESC LIMIT 1;
-- POST /api/orcamentos
INSERT INTO orcamentos (
  id, paciente_id, dentista_id, itens, valor_total, desconto, status, validade,
  observacoes, forma_pagamento, parcelas, titulo, print_config, odontograma_snapshot, tenant_id
) VALUES ('22222222-0000-0000-0000-000000000002', null, null, '[{"procedimento_id":"11111111-0000-0000-0000-000000000001"}]', 200, 0, 'pendente', NOW() + interval '30 days',
  'obs', 'pix', 1, 'Plano A', '{"logo":true}', '{"11":"carie"}', 'aaaaaaaa-0000-0000-0000-00000000000a');
-- PUT /api/orcamentos/:id
UPDATE orcamentos SET titulo='Plano B', print_config='{"logo":false}', odontograma_snapshot='{}', updated_at=NOW()
 WHERE id='22222222-0000-0000-0000-000000000002' AND tenant_id='aaaaaaaa-0000-0000-0000-00000000000a';
-- GET /api/reativacao/rules (trecho do WHERE)
INSERT INTO reactivation_rules (name, inactive_days, origin, message_template, status, created_by, tenant_id)
VALUES ('Regra A', 180, 'todos', 'Oi', 'ativo', null, 'aaaaaaaa-0000-0000-0000-00000000000a');
-- POST /api/reativacao/rules/:id/send — envio "falhou" sem tenant_id
INSERT INTO reactivation_sends (rule_id, paciente_id, lead_id, phone, message, status, error_message)
SELECT id, null, null, '', 'Oi', 'falhou', 'Telefone ausente' FROM reactivation_rules WHERE name='Regra A';
COMMIT;
-- hook da fila: SEM contexto de clínica, tenant_id explícito (server.mjs ~11776)
INSERT INTO reactivation_sends (rule_id, paciente_id, lead_id, phone, message, status, error_message, tenant_id)
SELECT id, null, null, '5511988887777', 'Oi', 'enviado', null, 'aaaaaaaa-0000-0000-0000-00000000000a' FROM reactivation_rules WHERE name='Regra A';
SQL
  then ok "INSERT/UPDATE/SELECT das rotas passam"; else erro "rotas"; cat "$LOG.rotas.$db"; fi
  checa "$db" "orçamento gravou titulo/print_config/odontograma_snapshot" \
    "select titulo='Plano B' and print_config->>'logo'='false' and odontograma_snapshot='{}'::jsonb from orcamentos where id='22222222-0000-0000-0000-000000000002'"
  checa "$db" "versão nova herdou tenant_id do procedimento (trigger)" \
    "select tenant_id='aaaaaaaa-0000-0000-0000-00000000000a' from procedimentos_catalogo_versoes where procedimento_id='11111111-0000-0000-0000-000000000001'"
  checa "$db" "envio 'falhou' sem tenant_id herdou o da regra e o KPI conta os 2" \
    "select count(*)=2 from reactivation_sends s join reactivation_rules r on r.id=s.rule_id where r.name='Regra A' and s.tenant_id='aaaaaaaa-0000-0000-0000-00000000000a'"
done
checa novo "tabelas novas: dono odonto_user, RLS ligada e tenant_isolation_policy" \
  "select (select bool_and(tableowner='odonto_user' and rowsecurity) from pg_tables where tablename in ('procedimentos_catalogo','procedimentos_catalogo_versoes')) and (select count(*)=2 from pg_policies where tablename like 'procedimentos_catalogo%' and policyname='tenant_isolation_policy')"
checa novo "odonto_app tem GRANT nas 4 tabelas" \
  "select bool_and(has_table_privilege('odonto_app', t, 'INSERT')) from unnest(array['reactivation_rules','reactivation_sends','procedimentos_catalogo','procedimentos_catalogo_versoes']) t"
# Isolamento: odonto_app (não dono) com contexto da clínica B não vê versões da A
if [ "$(ps_ -d novo -U odonto_app -tA -c "select set_config('app.tenant_id','bbbbbbbb-0000-0000-0000-00000000000b',false); select count(*) from procedimentos_catalogo_versoes" | tail -1)" = "0" ]; then
  ok "RLS: odonto_app na clínica B vê 0 versões da A"; else erro "RLS: odonto_app na clínica B vê versões da A"; fi

echo
if [ "$falhas" -eq 0 ]; then echo "TUDO OK"; else echo "$falhas FALHA(S)"; exit 1; fi
