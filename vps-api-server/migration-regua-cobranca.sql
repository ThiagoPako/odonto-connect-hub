-- Régua de cobrança — responsável financeiro do paciente (quem recebe a cobrança) e pausa
-- da cobrança de uma conta quando o paciente responde "já paguei" ou contesta.
-- Idempotente: pode rodar N vezes. Também roda no boot (auto-migration do server.mjs).
-- Rollback: colunas opcionais, podem ficar. Para remover (perde responsável e pausas):
--   ALTER TABLE pacientes DROP COLUMN IF EXISTS responsavel_telefone, DROP COLUMN IF EXISTS responsavel_nome;
--   ALTER TABLE financeiro DROP COLUMN IF EXISTS cobranca_pausa_motivo, DROP COLUMN IF EXISTS cobranca_pausada_em;
-- LGPD: responsavel_* é dado pessoal de terceiro; entra na exclusão por paciente (DELETE FROM pacientes).
ALTER TABLE IF EXISTS pacientes ADD COLUMN IF NOT EXISTS responsavel_nome TEXT;
ALTER TABLE IF EXISTS pacientes ADD COLUMN IF NOT EXISTS responsavel_telefone TEXT;
ALTER TABLE IF EXISTS financeiro ADD COLUMN IF NOT EXISTS cobranca_pausada_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS financeiro ADD COLUMN IF NOT EXISTS cobranca_pausa_motivo TEXT;
