-- Core permissions fix for sync process
GRANT USAGE ON SCHEMA public TO authenticated, service_role, anon;

-- Grant access to all existing tables in public schema
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'GRANT ALL PRIVILEGES ON TABLE public.' || quote_ident(r.tablename) || ' TO authenticated, service_role';
    END LOOP;
END $$;

-- Specifically ensure integration tables have correct owner and grants
ALTER TABLE IF EXISTS public.clinicorp_clinics OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_professionals OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_appointments OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_patients OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_estimates OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_appointment_categories OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_specialties OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_chairs OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_financial_entries OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_monthly_summary OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_webhook_events OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_conflicts OWNER TO postgres;
ALTER TABLE IF EXISTS public.clinicorp_local_overrides OWNER TO postgres;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Ensure RLS doesn't block the sync user (service_role or authenticated)
-- By granting ALL and ensuring policies allow is_super_admin() or matching tenant_id
