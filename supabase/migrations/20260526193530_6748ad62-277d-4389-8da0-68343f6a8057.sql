-- Ensure RLS is enabled on core tables
ALTER TABLE public.contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_movements ENABLE ROW LEVEL SECURITY;

-- Ensure tenant_id defaults to current_tenant_id()
ALTER TABLE public.contatos ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();
ALTER TABLE public.agendamentos ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();
ALTER TABLE public.chat_messages ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();
ALTER TABLE public.pacientes ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();
ALTER TABLE public.financeiro ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();
ALTER TABLE public.fin_movements ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();

-- Grant permissions (if missing)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contatos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agendamentos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pacientes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financeiro TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_movements TO authenticated;

-- Create or replace policies for strict tenant isolation
DO $$ 
DECLARE 
    t TEXT;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('contatos', 'agendamentos', 'chat_messages', 'pacientes', 'financeiro', 'fin_movements')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', t, t);
        EXECUTE format('CREATE POLICY %I_tenant_isolation ON public.%I FOR ALL TO authenticated USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid())) WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()))', t, t);
    END LOOP;
END $$;
