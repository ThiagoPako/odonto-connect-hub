-- Add indexes for performance with RLS
CREATE INDEX IF NOT EXISTS idx_agendamentos_tenant_id ON public.agendamentos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pacientes_tenant_id ON public.pacientes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contatos_tenant_id ON public.contatos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_tenant_id ON public.chat_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fin_movements_tenant_id ON public.fin_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_tenant_id ON public.orcamentos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_id ON public.leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_estoque_tenant_id ON public.estoque(tenant_id);

-- Ensure RLS is enabled for tables mentioned by user as problematic
ALTER TABLE IF EXISTS public.fin_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_messages ENABLE ROW LEVEL SECURITY;
