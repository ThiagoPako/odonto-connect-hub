-- Lista de espera e ofertas de encaixe (B8) — paciente aguardando horário e a oferta
-- de um horário liberado, um paciente por vez, com prazo de resposta pelo WhatsApp.
-- Idempotente: pode rodar N vezes. O server.mjs cria o mesmo no boot (ensureWaitlistSchema).
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

ALTER TABLE lista_espera ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lista_espera;
CREATE POLICY tenant_isolation_policy ON lista_espera FOR ALL
  USING (is_super_admin() OR tenant_id = get_current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id());
ALTER TABLE lista_espera_ofertas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lista_espera_ofertas;
CREATE POLICY tenant_isolation_policy ON lista_espera_ofertas FOR ALL
  USING (is_super_admin() OR tenant_id = get_current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id());
