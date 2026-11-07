-- Saúde do WhatsApp — estado de cada número por clínica e histórico de mudanças,
-- gravados pelo job checkWhatsAppHealth. Idempotente: pode rodar N vezes. O server.mjs
-- aplica o mesmo no boot (ensureWhatsAppHealthSchema).
-- Rollback: DROP TABLE whatsapp_instance_health_log; colunas novas de whatsapp_instances
-- são opcionais e podem ficar.
ALTER TABLE IF EXISTS whatsapp_instances ADD COLUMN IF NOT EXISTS connection_state TEXT;
ALTER TABLE IF EXISTS whatsapp_instances ADD COLUMN IF NOT EXISTS state_since TIMESTAMPTZ;
ALTER TABLE IF EXISTS whatsapp_instances ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS whatsapp_instances ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS whatsapp_instance_health_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  state TEXT NOT NULL,
  previous_state TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_health_log_tenant ON whatsapp_instance_health_log (tenant_id, instance_name, changed_at DESC);

ALTER TABLE whatsapp_instance_health_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON whatsapp_instance_health_log;
CREATE POLICY tenant_isolation_policy ON whatsapp_instance_health_log FOR ALL
  USING ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
