-- Canais de WhatsApp por clínica (camada de provedor, F0 de docs/whatsapp/migracao-provedores.md).
-- Um canal = um número de uma clínica num provedor: 'evolution' (transição), 'openwa' (reserva por
-- QR) ou 'cloud' (Cloud API oficial da Meta). Substitui whatsapp_instances aos poucos; na F0 nada
-- lê esta tabela ainda (comportamento igual), ela só é criada e preenchida a partir das instâncias.
-- Idempotente: pode rodar N vezes. O server.mjs aplica o mesmo no boot (ensureWhatsAppChannelsSchema).
-- Credenciais (token da Meta, API key da sessão OpenWA, segredo de webhook) só cifradas
-- (AES-256-GCM, chave WA_CREDENTIALS_KEY; formato "v<versão>:iv:tag:dados"); nunca em claro.
-- Rollback: DROP TABLE whatsapp_webhook_events; DROP TABLE whatsapp_channels; (perde só o que esta
-- migração criou; whatsapp_instances continua intacta). Colunas channel_id/provider_message_id de
-- automation_jobs e chat_messages são opcionais e podem ficar.
CREATE TABLE IF NOT EXISTS whatsapp_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('evolution', 'openwa', 'cloud')),
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'backup')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  external_id TEXT NOT NULL,
  waba_id TEXT,
  display_phone TEXT,
  credentials_enc TEXT,
  credentials_key_version INT,
  connection_state TEXT,
  state_since TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_alert_at TIMESTAMPTZ,
  paused_until TIMESTAMPTZ,
  pause_reason TEXT,
  quality_rating TEXT,
  messaging_limit TEXT,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_channels_provider_ext ON whatsapp_channels (provider, external_id);
CREATE INDEX IF NOT EXISTS idx_wa_channels_tenant ON whatsapp_channels (tenant_id, role, status);

-- Dedupe dos webhooks (Meta reentrega por até 7 dias; OpenWA manda X-OpenWA-Idempotency-Key).
-- Sem tenant: a linha é gravada antes de saber a clínica e não guarda conteúdo. Limpar > 8 dias.
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_webhook_events_received ON whatsapp_webhook_events (received_at);

ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS channel_id UUID;
ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE IF EXISTS chat_messages ADD COLUMN IF NOT EXISTS channel_id UUID;
ALTER TABLE IF EXISTS chat_messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

-- Cada instância Evolution com clínica vira um canal 'evolution' (regra: o tenant_id da própria
-- instância; instância sem clínica fica de fora). Copia o estado de saúde e a pausa.
-- Só insere o que falta (não altera canal existente).
INSERT INTO whatsapp_channels (tenant_id, provider, role, external_id, connection_state, state_since,
                               last_checked_at, last_alert_at, paused_until, pause_reason, created_at)
SELECT wi.tenant_id, 'evolution', 'primary', wi.instance_name, wi.connection_state, wi.state_since,
       wi.last_checked_at, wi.last_alert_at, wi.paused_until, wi.pause_reason, COALESCE(wi.created_at, NOW())
  FROM whatsapp_instances wi
 WHERE wi.tenant_id IS NOT NULL
ON CONFLICT (provider, external_id) DO NOTHING;

ALTER TABLE whatsapp_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON whatsapp_channels;
CREATE POLICY tenant_isolation_policy ON whatsapp_channels FOR ALL
  USING ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
