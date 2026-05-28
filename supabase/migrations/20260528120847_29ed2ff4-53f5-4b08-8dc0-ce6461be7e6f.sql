-- Core RLS functions
CREATE OR REPLACE FUNCTION public.get_current_tenant_id() RETURNS UUID AS $$
  BEGIN
    RETURN current_setting('app.tenant_id', true)::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS BOOLEAN AS $$
  DECLARE
    payload TEXT;
    simple_check TEXT;
  BEGIN
    -- Check simple session variable first
    simple_check := current_setting('app.is_super_admin', true);
    IF simple_check = 'true' THEN
      RETURN TRUE;
    END IF;

    -- Fallback to JWT payload
    payload := current_setting('app.jwt_payload', true);
    IF payload IS NOT NULL AND payload <> '' THEN
      RETURN (payload::jsonb->>'is_super_admin')::boolean;
    END IF;

    RETURN FALSE;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.get_current_tenant_id() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, anon, service_role;

-- Grant access to authenticated users for all tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Create missing tables if they really don't exist
CREATE TABLE IF NOT EXISTS public.clinicorp_clinics (
    id TEXT PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    company_id BIGINT,
    business_id BIGINT,
    business_name TEXT,
    name TEXT,
    email TEXT,
    address TEXT,
    active BOOLEAN,
    landline TEXT,
    other_landline TEXT,
    slot_time INTEGER,
    no_limit_apt_same_time BOOLEAN,
    subscriber_business_uid TEXT,
    working_days_hours JSONB,
    raw JSONB,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clinicorp_professionals (
    id TEXT PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    full_name TEXT,
    user_name TEXT,
    raw JSONB,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clinicorp_appointments (
    id TEXT PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    business_id BIGINT,
    patient_id BIGINT,
    patient_name TEXT,
    professional_id BIGINT,
    professional_name TEXT,
    category_id BIGINT,
    category_description TEXT,
    category_color TEXT,
    chair_id BIGINT,
    status TEXT,
    date DATE,
    from_time TIME,
    to_time TIME,
    notes TEXT,
    raw JSONB,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clinicorp_local_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type TEXT NOT NULL,
    scope_id TEXT,
    keep_local BOOLEAN DEFAULT FALSE,
    conflict_strategy TEXT,
    note TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Re-apply policies for main tables using public.get_current_tenant_id()
DROP POLICY IF EXISTS tenant_isolation_policy ON public.dentistas;
CREATE POLICY tenant_isolation_policy ON public.dentistas FOR ALL USING (public.is_super_admin() OR tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_policy ON public.pacientes;
CREATE POLICY tenant_isolation_policy ON public.pacientes FOR ALL USING (public.is_super_admin() OR tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_policy ON public.agendamentos;
CREATE POLICY tenant_isolation_policy ON public.agendamentos FOR ALL USING (public.is_super_admin() OR tenant_id = public.get_current_tenant_id());

-- Re-apply to integration tables
ALTER TABLE public.clinicorp_clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinicorp_professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinicorp_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinicorp_local_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON public.clinicorp_clinics;
CREATE POLICY tenant_isolation_policy ON public.clinicorp_clinics FOR ALL USING (public.is_super_admin() OR tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_policy ON public.clinicorp_professionals;
CREATE POLICY tenant_isolation_policy ON public.clinicorp_professionals FOR ALL USING (public.is_super_admin() OR tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_policy ON public.clinicorp_appointments;
CREATE POLICY tenant_isolation_policy ON public.clinicorp_appointments FOR ALL USING (public.is_super_admin() OR tenant_id = public.get_current_tenant_id());

-- Grant access to everything again
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
