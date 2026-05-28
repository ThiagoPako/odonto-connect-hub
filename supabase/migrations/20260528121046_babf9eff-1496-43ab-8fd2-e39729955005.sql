-- Ensure extensions exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Add missing columns to local projection tables
ALTER TABLE public.dentistas ADD COLUMN IF NOT EXISTS clinicorp_professional_id TEXT;
ALTER TABLE public.dentistas ADD COLUMN IF NOT EXISTS last_clinicorp_sync_at TIMESTAMPTZ;
ALTER TABLE public.dentistas ADD COLUMN IF NOT EXISTS keep_local BOOLEAN DEFAULT FALSE;

ALTER TABLE public.pacientes ADD COLUMN IF NOT EXISTS clinicorp_patient_id TEXT;
ALTER TABLE public.pacientes ADD COLUMN IF NOT EXISTS last_clinicorp_sync_at TIMESTAMPTZ;
ALTER TABLE public.pacientes ADD COLUMN IF NOT EXISTS keep_local BOOLEAN DEFAULT FALSE;

ALTER TABLE public.agendamentos ADD COLUMN IF NOT EXISTS last_clinicorp_sync_at TIMESTAMPTZ;
ALTER TABLE public.agendamentos ADD COLUMN IF NOT EXISTS keep_local BOOLEAN DEFAULT FALSE;

-- 2. Fix permissions properly
-- Use more broad permissions for the integration role/user
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, service_role;

-- Authenticated users need permissions for their own operations
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 3. Ensure tables used by sync exist with correct structure
CREATE TABLE IF NOT EXISTS public.clinicorp_local_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type TEXT NOT NULL,
    scope_id TEXT,
    keep_local BOOLEAN DEFAULT FALSE,
    conflict_strategy TEXT,
    note TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clinicorp_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity TEXT NOT NULL,
    clinicorp_id TEXT,
    local_id TEXT,
    decision TEXT,
    strategy TEXT,
    scope_type TEXT,
    scope_id TEXT,
    local_updated_at TIMESTAMPTZ,
    clinicorp_updated_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    diff JSONB,
    before_data JSONB,
    after_data JSONB,
    changed_fields TEXT[],
    paciente_id UUID,
    lead_id UUID,
    agendamento_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE
);

-- 4. Enable RLS and set policies
ALTER TABLE public.clinicorp_local_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinicorp_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON public.clinicorp_local_overrides;
CREATE POLICY tenant_isolation_policy ON public.clinicorp_local_overrides FOR ALL USING (true); -- Overrides are global for now or refine if needed

DROP POLICY IF EXISTS tenant_isolation_policy ON public.clinicorp_conflicts;
CREATE POLICY tenant_isolation_policy ON public.clinicorp_conflicts FOR ALL USING (public.is_super_admin() OR tenant_id = public.get_current_tenant_id());
