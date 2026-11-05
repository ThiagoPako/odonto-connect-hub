-- Histórico de "retornar à fila" e "reabrir atendimento" no chat (quem fez e quando).
-- Idempotente: pode rodar N vezes. O boot do server.mjs cria a mesma tabela.
-- Rollback: DROP TABLE attendance_session_events; (perde só o histórico dessas ações).
CREATE TABLE IF NOT EXISTS attendance_session_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id UUID,
  lead_id TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id UUID,
  user_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attendance_session_events_tenant
  ON attendance_session_events (tenant_id, lead_id, created_at DESC);
ALTER TABLE attendance_session_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_current_tenant_id')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_super_admin') THEN
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON attendance_session_events';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON attendance_session_events FOR ALL
      USING (is_super_admin() OR tenant_id = get_current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id())';
  END IF;
END $$;
