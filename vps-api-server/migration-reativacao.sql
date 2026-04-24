-- ═══════════════════════════════════════════════════════════════
-- REATIVAÇÃO DE PACIENTES INATIVOS
-- Regras configuráveis + log de envios
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reactivation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  inactive_days INTEGER NOT NULL DEFAULT 180 CHECK (inactive_days >= 1),
  origin TEXT NOT NULL DEFAULT 'todos',           -- instagram|facebook|google|indicacao|whatsapp|site|todos
  message_template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('ativo','pausado','rascunho')),
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_run_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reactivation_rules_status ON reactivation_rules(status);

CREATE TABLE IF NOT EXISTS reactivation_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES reactivation_rules(id) ON DELETE CASCADE,
  paciente_id UUID,
  lead_id UUID,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','falhou','respondido')),
  error_message TEXT,
  responded_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reactivation_sends_rule ON reactivation_sends(rule_id);
CREATE INDEX IF NOT EXISTS idx_reactivation_sends_paciente ON reactivation_sends(paciente_id);
CREATE INDEX IF NOT EXISTS idx_reactivation_sends_phone ON reactivation_sends(phone);
CREATE INDEX IF NOT EXISTS idx_reactivation_sends_sent_at ON reactivation_sends(sent_at DESC);
