-- Lista de espera e ofertas de encaixe (B8) — paciente aguardando horário e a oferta
-- de um horário liberado, um paciente por vez, com prazo de resposta pelo WhatsApp.
-- Idempotente: pode rodar N vezes. Política no mesmo formato do apply_tenant_rls do boot
-- (current_setting), sem depender de is_super_admin(), que não existe em todo banco. O server.mjs cria o mesmo no boot (ensureWaitlistSchema).
-- Rollback: DROP TABLE lista_espera_ofertas; DROP TABLE lista_espera; (perde a lista e o histórico de ofertas).
CREATE TABLE IF NOT EXISTS lista_espera (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  dentista_id UUID REFERENCES dentistas(id) ON DELETE SET NULL,
  periodo TEXT NOT NULL DEFAULT 'qualquer',
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lista_espera_tenant ON lista_espera (tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS lista_espera_ofertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  lista_espera_id UUID NOT NULL REFERENCES lista_espera(id) ON DELETE CASCADE,
  paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  agendamento_origem_id UUID NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
  agendamento_novo_id UUID REFERENCES agendamentos(id) ON DELETE SET NULL,
  data DATE NOT NULL,
  hora TEXT NOT NULL,
  duracao INTEGER,
  dentista_id UUID,
  status TEXT NOT NULL DEFAULT 'enviada',
  expires_at TIMESTAMPTZ NOT NULL,
  job_id TEXT,
  oferecido_por UUID,
  answered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lista_espera_ofertas_tenant ON lista_espera_ofertas (tenant_id, agendamento_origem_id, status);
-- Um paciente por vez: no máximo uma oferta aguardando resposta por horário.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lista_espera_oferta_ativa ON lista_espera_ofertas (agendamento_origem_id) WHERE status = 'enviada';

-- Quem liberou o horário e quando (cancelado/desmarcado pela recepção).
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS liberado_por UUID;
ALTER TABLE IF EXISTS agendamentos ADD COLUMN IF NOT EXISTS liberado_em TIMESTAMPTZ;

ALTER TABLE lista_espera ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lista_espera;
CREATE POLICY tenant_isolation_policy ON lista_espera FOR ALL
  USING ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
ALTER TABLE lista_espera_ofertas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lista_espera_ofertas;
CREATE POLICY tenant_isolation_policy ON lista_espera_ofertas FOR ALL
  USING ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((current_setting('app.is_super_admin', true) = 'true') OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
