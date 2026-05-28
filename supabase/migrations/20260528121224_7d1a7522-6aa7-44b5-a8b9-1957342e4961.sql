-- Final push for permissions
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Grant access to all tables in public schema
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'GRANT ALL PRIVILEGES ON TABLE public.' || quote_ident(r.tablename) || ' TO authenticated, service_role';
    END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Ensure these specific tables are accessible even if they were just created
GRANT ALL PRIVILEGES ON public.clinicorp_clinics TO authenticated, service_role;
GRANT ALL PRIVILEGES ON public.clinicorp_professionals TO authenticated, service_role;
GRANT ALL PRIVILEGES ON public.clinicorp_appointments TO authenticated, service_role;
GRANT ALL PRIVILEGES ON public.clinicorp_patients TO authenticated, service_role;
GRANT ALL PRIVILEGES ON public.clinicorp_estimates TO authenticated, service_role;
GRANT ALL PRIVILEGES ON public.agendamentos TO authenticated, service_role;
GRANT ALL PRIVILEGES ON public.pacientes TO authenticated, service_role;
GRANT ALL PRIVILEGES ON public.dentistas TO authenticated, service_role;
