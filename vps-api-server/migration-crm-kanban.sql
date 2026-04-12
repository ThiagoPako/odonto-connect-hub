-- ═══════════════════════════════════════════════════════════
-- CRM Kanban — New stages + consciousness levels + audit log
-- Run: sudo -u postgres psql -p 5433 -d odonto_db -f migration-crm-kanban.sql
-- ═══════════════════════════════════════════════════════════

-- 1. Add consciousness_level column to crm_leads
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS consciousness_level TEXT;

-- 2. Add assigned_to columns for lead ownership
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES profiles(id);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_to_name TEXT;

-- 3. Add value/budget tracking
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS valor NUMERIC(12,2) DEFAULT 0;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS orcamento_id UUID REFERENCES orcamentos(id);

-- 4. Kanban movement audit log
CREATE TABLE IF NOT EXISTS kanban_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  moved_by UUID REFERENCES profiles(id),
  moved_by_name TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kanban_movements_lead ON kanban_movements(lead_id);
CREATE INDEX IF NOT EXISTS idx_kanban_movements_created ON kanban_movements(created_at DESC);

-- 5. Migrate old stage names to new ones
UPDATE crm_leads SET kanban_stage = 'em_atendimento' WHERE kanban_stage = 'em_contato';
UPDATE crm_leads SET kanban_stage = 'followup' WHERE kanban_stage = 'followup_1';

-- 6. Index on kanban_stage for faster grouping
CREATE INDEX IF NOT EXISTS idx_crm_leads_kanban_stage ON crm_leads(kanban_stage);
CREATE INDEX IF NOT EXISTS idx_crm_leads_consciousness ON crm_leads(consciousness_level);

-- 7. Add paciente_id column to link leads to patients
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS paciente_id UUID REFERENCES pacientes(id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_paciente ON crm_leads(paciente_id);
