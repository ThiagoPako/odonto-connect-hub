#!/usr/bin/env bash
# Cria/recria o banco LOCAL de testes (odonto_local) e semeia dados fictícios.
# Pré-requisito: Postgres 16 rodando (brew install postgresql@16 && brew services start postgresql@16).
# Uso: bash vps-api-server/setup-local.sh [--recriar]   — NUNCA aponte para produção.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
DB="${ODONTO_LOCAL_DB:-odonto_local}"
[[ "${1:-}" == "--recriar" ]] && dropdb --if-exists "$DB"
createdb "$DB" 2>/dev/null || true
psql -q -d postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='odonto_user') THEN CREATE ROLE odonto_user LOGIN PASSWORD 'local_test_pw' SUPERUSER; END IF; END \$\$;"
# Ordem importa: algumas migrations dependem de tabelas de outras; rodamos duas passadas e ignoramos erros de dependência.
ORDEM=(migration.sql migration-chat-messages.sql migration-push-subscriptions.sql migration-crm-kanban.sql migration-priority-recovery.sql
  migration-user-preferences.sql migration-ai-settings.sql migration-reativacao.sql migration-clinicorp.sql migration-clinicorp-user.sql
  migration-saas.sql migration-tenant-defaults.sql migration-whatsapp-fase1.sql
  migration-saas.sql migration-chat-messages.sql migration-priority-recovery.sql migration-clinicorp.sql migration-tenant-defaults.sql
  migration-system-settings.sql migration-attendance-sessions.sql migration-consultations.sql migration-exames.sql
  migration-financeiro-modulos.sql migration-finance-multitenant.sql migration-clinicorp-multitenant.sql migration-clinicorp-bidirectional.sql
  migration-orcamentos-clinicorp.sql migration-meta-ads.sql migration-full-audit.sql schema-complementar-local.sql
  migration-whatsapp-fase1.sql migration-attendance-sessions.sql migration-clinicorp-multitenant.sql migration-seguranca-p0.sql)
for f in "${ORDEM[@]}"; do [[ -f "$f" ]] && psql -q -d "$DB" -f "$f" >/dev/null 2>&1 || true; done
# O servidor também migra no boot (ex.: adiciona tenant_id em crm_leads): sobe uma vez numa porta de descarte.
if [[ -f .env ]] || true; then
  PG_DATABASE="$DB" PG_USER=odonto_user PG_PASSWORD=local_test_pw PG_HOST=localhost JWT_SECRET=local-setup API_PORT=3099 EVOLUTION_API_URL=http://127.0.0.1:9 \
    node server.mjs >/dev/null 2>&1 & SRV=$!
  sleep 14; kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true
fi
for f in schema-complementar-local.sql migration-seguranca-p0.sql; do psql -q -d "$DB" -f "$f" >/dev/null 2>&1 || true; done
psql -q -d "$DB" -f seed-local.sql
echo "ok: banco $DB pronto. Senha de todos os usuários de teste: Teste@123 (veja docs/operacao/ambiente-local.md)"
