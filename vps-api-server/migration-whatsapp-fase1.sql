-- WhatsApp Fase 1 — isolamento por clínica e fila anti-bloqueio
-- Idempotente. O servidor também aplica estes comandos no boot
-- (ensureWhatsAppQueueSchema em server.mjs); este arquivo serve para aplicar
-- manualmente / revisar antes do deploy.
--
-- Rollback (só se precisar voltar a versão anterior do server.mjs):
--   as colunas novas são opcionais para o código antigo e podem ficar.
--   DROP TABLE whatsapp_opt_outs;  -- perde a lista de descadastros (evite)

-- Fila de envio
ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'transactional';
ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;
ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;  -- após isso a mensagem é descartada
CREATE INDEX IF NOT EXISTS idx_automation_jobs_due ON automation_jobs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_instance_sent ON automation_jobs (instance, sent_at);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_tenant ON automation_jobs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_tenant_sent ON automation_jobs (tenant_id, sent_at) WHERE status = 'sent';

-- Fluxos e campanhas passam a pertencer a uma clínica
ALTER TABLE IF EXISTS automation_flows ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS broadcast_campaigns ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Pausa automática do número
ALTER TABLE IF EXISTS whatsapp_instances ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ;
ALTER TABLE IF EXISTS whatsapp_instances ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- Descadastro (SAIR) por clínica. phone_key = DDD + 8 últimos dígitos.
CREATE TABLE IF NOT EXISTS whatsapp_opt_outs (
  tenant_id UUID NOT NULL,
  phone_key TEXT NOT NULL,
  phone TEXT,
  source TEXT,
  keyword TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, phone_key)
);

-- Opt-out desfeito pela clínica a pedido do paciente: como pediu, quem desfez e quando.
CREATE TABLE IF NOT EXISTS whatsapp_opt_out_reversals (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  phone_key TEXT NOT NULL,
  phone TEXT,
  opted_out_at TIMESTAMPTZ,
  keyword TEXT,
  lead_id TEXT,
  requested_via TEXT NOT NULL,
  reverted_by UUID,
  reverted_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_opt_out_reversals_tenant ON whatsapp_opt_out_reversals (tenant_id, phone_key, created_at DESC);

-- Preenche a clínica dos registros antigos
UPDATE automation_flows f SET tenant_id = p.tenant_id FROM profiles p
 WHERE f.tenant_id IS NULL AND p.id::text = f.created_by::text AND p.tenant_id IS NOT NULL;
UPDATE broadcast_campaigns c SET tenant_id = p.tenant_id FROM profiles p
 WHERE c.tenant_id IS NULL AND p.id::text = c.created_by::text AND p.tenant_id IS NOT NULL;
UPDATE automation_jobs j SET tenant_id = w.tenant_id FROM whatsapp_instances w
 WHERE j.tenant_id IS NULL AND w.instance_name = j.instance AND w.tenant_id IS NOT NULL;

-- Conferência pós-migração (devem voltar 0; se não, atribuir a clínica à mão):
-- SELECT COUNT(*) FROM automation_flows WHERE tenant_id IS NULL;
-- SELECT COUNT(*) FROM broadcast_campaigns WHERE tenant_id IS NULL;
-- SELECT COUNT(*) FROM automation_jobs WHERE status = 'pending' AND tenant_id IS NULL;

-- Jobs pendentes antigos ganham validade de 7 dias a partir do agendamento
UPDATE automation_jobs SET expires_at = scheduled_at + INTERVAL '7 days'
 WHERE status = 'pending' AND expires_at IS NULL;
