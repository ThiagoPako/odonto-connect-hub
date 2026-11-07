-- Canais de WhatsApp por clínica (camada de provedor, docs/whatsapp/migracao-provedores.md).
-- Um canal = um número de uma clínica num provedor: 'evolution' (transição), 'openwa' (reserva por
-- QR) ou 'cloud' (Cloud API oficial da Meta). Todo canal tem um instance_name: a chave do número
-- em whatsapp_instances, que a fila usa para ritmo, limites, pausa e dono.
-- Idempotente: pode rodar N vezes. O server.mjs aplica o mesmo no boot (ensureWhatsAppChannelsSchema,
-- que respeita os blocos $$ ... $$ ao dividir os comandos).
-- Sincronia com whatsapp_instances (revisão do Igor, M1): um gatilho na própria whatsapp_instances
-- grava, reatribui e apaga o canal NA MESMA TRANSAÇÃO de qualquer escrita na instância (são 8 pontos
-- de escrita no server.mjs; o gatilho cobre todos e os futuros).
-- Credenciais (API key da sessão OpenWA, segredo de webhook, token da Meta) só cifradas
-- (AES-256-GCM, chave WA_CREDENTIALS_KEY, AAD = id do canal + tenant); nunca em claro.
-- Rollback: DROP TRIGGER trg_wa_instances_sync_channels ON whatsapp_instances;
--   DROP FUNCTION wa_sync_channel_from_instance(); DROP TABLE whatsapp_webhook_events;
--   DROP TABLE whatsapp_channels; (perde só o que esta migração criou, inclusive canais OpenWA e
--   suas credenciais cifradas; whatsapp_instances continua intacta). Colunas channel_id/
--   provider_message_id de automation_jobs e chat_messages são opcionais e podem ficar.
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
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS instance_name TEXT;
UPDATE whatsapp_channels SET instance_name = external_id WHERE instance_name IS NULL AND provider = 'evolution';
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_channels_provider_ext ON whatsapp_channels (provider, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_channels_instance_name ON whatsapp_channels (instance_name) WHERE instance_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_channels_tenant ON whatsapp_channels (tenant_id, role, status);
-- No máximo um número reserva (OpenWA) ativo por clínica: dois cliques simultâneos em "conectar"
-- não criam duas sessões (revisão F1, I4). Hoje não há canal OpenWA em produção.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_channels_one_openwa ON whatsapp_channels (tenant_id) WHERE provider = 'openwa' AND status = 'active';

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

-- Backfill: cada instância com clínica vira um canal 'evolution' (regra: o tenant_id da própria
-- instância). Se o canal já existe, a clínica é corrigida para a da instância (DO UPDATE).
-- Instância sem clínica fica de fora. Principal = a instância mais antiga da clínica.
INSERT INTO whatsapp_channels (tenant_id, provider, role, external_id, instance_name, connection_state, state_since,
                               last_checked_at, last_alert_at, paused_until, pause_reason, created_at)
SELECT wi.tenant_id, 'evolution',
       CASE WHEN ROW_NUMBER() OVER (PARTITION BY wi.tenant_id ORDER BY wi.created_at ASC NULLS LAST, wi.instance_name) = 1 THEN 'primary' ELSE 'backup' END,
       wi.instance_name, wi.instance_name, wi.connection_state, wi.state_since,
       wi.last_checked_at, wi.last_alert_at, wi.paused_until, wi.pause_reason, COALESCE(wi.created_at, NOW())
  FROM whatsapp_instances wi
 WHERE wi.tenant_id IS NOT NULL
   -- Instância que já tem canal de outro provedor (OpenWA/Cloud, criado pela API) fica como está:
   -- sem isto o INSERT viola uq_wa_channels_instance_name e aborta o resto do arquivo no deploy
   -- (revisão F1, B2).
   AND NOT EXISTS (SELECT 1 FROM whatsapp_channels c WHERE c.instance_name = wi.instance_name AND c.provider <> 'evolution')
ON CONFLICT (provider, external_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, instance_name = EXCLUDED.instance_name, updated_at = NOW();

-- Canal 'evolution' cuja instância não existe mais (ou ficou sem clínica) sai.
DELETE FROM whatsapp_channels c
 WHERE c.provider = 'evolution'
   AND NOT EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.instance_name = c.instance_name AND wi.tenant_id IS NOT NULL);

-- Um principal ativo por clínica: rebaixa os excedentes (fica o mais antigo) antes do índice único.
UPDATE whatsapp_channels c SET role = 'backup', updated_at = NOW()
 WHERE c.role = 'primary' AND c.status = 'active'
   AND EXISTS (SELECT 1 FROM whatsapp_channels o
                WHERE o.tenant_id = c.tenant_id AND o.role = 'primary' AND o.status = 'active'
                  AND (o.created_at, o.id) < (c.created_at, c.id));
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_channels_one_primary ON whatsapp_channels (tenant_id) WHERE role = 'primary' AND status = 'active';

-- Gatilho: qualquer escrita em whatsapp_instances acompanha o canal na mesma transação.
-- INSERT/UPDATE com clínica: cria o canal 'evolution' se não houver canal para o instance_name
-- (canal OpenWA/Cloud criado antes pela API é respeitado); se a clínica mudou, reatribui e rebaixa
-- para reserva (vira principal só se a clínica nova não tiver principal). Clínica NULL ou DELETE:
-- o canal sai (nunca fica apontando para a clínica antiga).
CREATE OR REPLACE FUNCTION wa_sync_channel_from_instance() RETURNS trigger AS $$
DECLARE
  ch RECORD;
  has_primary BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM whatsapp_channels WHERE instance_name = OLD.instance_name;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.instance_name IS DISTINCT FROM OLD.instance_name THEN
    DELETE FROM whatsapp_channels WHERE instance_name = OLD.instance_name;
  END IF;
  IF NEW.tenant_id IS NULL THEN
    DELETE FROM whatsapp_channels WHERE instance_name = NEW.instance_name;
    RETURN NEW;
  END IF;
  SELECT id, tenant_id, provider INTO ch FROM whatsapp_channels WHERE instance_name = NEW.instance_name LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM whatsapp_channels
                  WHERE tenant_id = NEW.tenant_id AND role = 'primary' AND status = 'active'
                    AND (ch.id IS NULL OR id <> ch.id)) INTO has_primary;
  IF ch.id IS NULL THEN
    INSERT INTO whatsapp_channels (tenant_id, provider, role, external_id, instance_name, created_at)
    VALUES (NEW.tenant_id, 'evolution', CASE WHEN has_primary THEN 'backup' ELSE 'primary' END,
            NEW.instance_name, NEW.instance_name, COALESCE(NEW.created_at, NOW()))
    ON CONFLICT (provider, external_id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id, instance_name = EXCLUDED.instance_name, updated_at = NOW();
  ELSIF ch.tenant_id <> NEW.tenant_id AND ch.provider <> 'evolution' THEN
    -- Canal OpenWA/Cloud reatribuído (revisão F1, M1): o número no provedor continua sendo da
    -- clínica antiga. Desativa e troca o external_id por um valor que nunca casa com sessão nem
    -- phone_number_id real — a clínica nova nunca recebe mensagens dos pacientes da antiga.
    UPDATE whatsapp_channels
       SET tenant_id = NEW.tenant_id, role = 'backup', status = 'disabled',
           external_id = 'revogado:' || id::text, display_phone = NULL, waba_id = NULL,
           credentials_enc = NULL, credentials_key_version = NULL, connection_state = NULL, updated_at = NOW()
     WHERE id = ch.id;
  ELSIF ch.tenant_id <> NEW.tenant_id THEN
    -- Reatribuição: credenciais cifradas usam AAD com a clínica antiga, então ficam inválidas
    -- e são apagadas (o canal precisa ser reconectado pela clínica nova).
    UPDATE whatsapp_channels
       SET tenant_id = NEW.tenant_id, role = CASE WHEN has_primary THEN 'backup' ELSE 'primary' END,
           credentials_enc = NULL, credentials_key_version = NULL, connection_state = NULL, updated_at = NOW()
     WHERE id = ch.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wa_instances_sync_channels ON whatsapp_instances;
CREATE TRIGGER trg_wa_instances_sync_channels
  AFTER INSERT OR UPDATE OF instance_name, tenant_id OR DELETE ON whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION wa_sync_channel_from_instance();

ALTER TABLE whatsapp_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON whatsapp_channels;
CREATE POLICY tenant_isolation_policy ON whatsapp_channels FOR ALL
  USING ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
