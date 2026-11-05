---
name: odonto-migracao
description: Use when creating or changing a table, column, index, constraint or RLS policy in the Odonto Connect PostgreSQL database, writing a vps-api-server/migration-*.sql file, touching the auto-migration list in server.mjs, or planning retenção/exclusão de dados (LGPD).
---

# Migrações de banco — Odonto Connect

## Como o schema chega em produção (dois caminhos — mantenha os dois coerentes)
1. **Boot do servidor:** `server.mjs`, bloco "Auto-migration" (procure `const migrations = [`
   perto do fim do arquivo) e funções `ensure*Schema` (ex.: `ensureWhatsAppQueueSchema`).
   Cada comando roda a cada start; erros 42701/42P07/42723 são ignorados, outros viram só `warn`.
2. **Deploy:** `.github/workflows/deploy.yml` roda uma **lista fixa** de `migration-*.sql` com
   `psql -p 5433 -d odonto_db ... || true` — erro **não para o deploy**. Arquivo novo só roda se
   for **adicionado a essa lista** (antes de "Migrations applied").

O código que usa a coluna nova não pode quebrar se ela ainda não existir no primeiro segundo
do boot (o `listen` sobe antes do auto-migration terminar).

## Modelo de arquivo `vps-api-server/migration-<tema>.sql`
```sql
-- <Tema> — <por quê>. Idempotente: pode rodar N vezes.
-- Rollback: <comando exato e o que se perde>, ou "colunas opcionais, podem ficar".
CREATE TABLE IF NOT EXISTS exemplo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE IF EXISTS exemplo ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ativo';
CREATE INDEX IF NOT EXISTS idx_exemplo_tenant ON exemplo (tenant_id, paciente_id);
ALTER TABLE exemplo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON exemplo;
CREATE POLICY tenant_isolation_policy ON exemplo FOR ALL
  USING (is_super_admin() OR tenant_id = get_current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id());
```

## Regras
- Toda tabela de dados de clínica: `tenant_id NOT NULL` + índice começando por `tenant_id` + política.
  A RLS é defesa extra (hoje não protege: `NO FORCE` e app dona das tabelas) — a query **também** filtra.
- Só `IF NOT EXISTS` / `IF EXISTS` / `DO $$ ... $$`. Nada de `DROP`/`TRUNCATE`/`UPDATE` em massa
  sem pedido explícito e plano de rollback; backfill de `tenant_id` precisa de regra clara, não
  "primeiro admin".
- `NOT NULL` em coluna existente: primeiro backfill, depois `SET NOT NULL` em migração separada.
- Fila/jobs concorrentes: `FOR UPDATE SKIP LOCKED` + status "processing" + `claimed_at`.
- LGPD: dado de saúde tem prazo (prontuário 20 anos — Lei 13.787 art. 6º); exclusão por paciente
  e por clínica precisa cobrir todas as tabelas com `paciente_id`/telefone.
- Nunca conectar no banco de produção nem rodar migração. Entregue a ordem de aplicação ao
  `otavio-devops`; ele inclui o arquivo no `deploy.yml`.

## Verificar localmente
`node --check vps-api-server/server.mjs`; se houver Postgres local: `psql -f migration-x.sql` duas
vezes seguidas (a segunda não pode dar erro) e `cd vps-api-server && npm test`.
