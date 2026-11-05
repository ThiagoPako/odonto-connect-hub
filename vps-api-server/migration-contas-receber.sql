-- Contas a receber de paciente na tabela financeiro (tipo 'receita'): vínculo com o
-- orçamento que gerou as parcelas e data em que o pagamento foi recebido.
-- Idempotente: pode rodar N vezes. Também roda no boot (auto-migration do server.mjs).
-- Rollback: colunas e índices opcionais, podem ficar. Para remover:
--   DROP INDEX IF EXISTS ux_financeiro_orcamento_parcela; DROP INDEX IF EXISTS idx_financeiro_receber;
--   ALTER TABLE financeiro DROP COLUMN IF EXISTS pago_em, DROP COLUMN IF EXISTS orcamento_id;  (perde datas de baixa e o vínculo)
ALTER TABLE IF EXISTS financeiro ADD COLUMN IF NOT EXISTS orcamento_id UUID;
ALTER TABLE IF EXISTS financeiro ADD COLUMN IF NOT EXISTS pago_em DATE;
CREATE INDEX IF NOT EXISTS idx_financeiro_receber ON financeiro (tenant_id, tipo, status, vencimento);
-- Impede gerar as parcelas do mesmo orçamento duas vezes (corrida de clique duplo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_financeiro_orcamento_parcela
  ON financeiro (tenant_id, orcamento_id, parcela_atual)
  WHERE orcamento_id IS NOT NULL AND status <> 'cancelado';
