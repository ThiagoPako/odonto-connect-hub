-- CRM / Commercial Module Migration

-- 1. Funnels and Steps
CREATE TABLE public.funis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  cor TEXT,
  ordem INTEGER DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.etapas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  funil_id UUID NOT NULL REFERENCES public.funis(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cor TEXT,
  ordem INTEGER DEFAULT 0,
  probabilidade INTEGER DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Leads
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  nome TEXT NOT NULL,
  email TEXT,
  telefone TEXT,
  origem TEXT, -- meta, google, whatsapp, indicacao
  status TEXT DEFAULT 'novo', -- novo, em_atendimento, agendado, convertido, perdido
  funil_id UUID REFERENCES public.funis(id) ON DELETE SET NULL,
  etapa_id UUID REFERENCES public.etapas(id) ON DELETE SET NULL,
  valor_estimado DECIMAL(12,2) DEFAULT 0,
  observacoes TEXT,
  atendente_id UUID, -- links to profiles or a dedicated atendentes table
  paciente_id UUID REFERENCES public.pacientes(id) ON DELETE SET NULL, -- if converted
  data_conversao TIMESTAMP WITH TIME ZONE,
  data_perda TIMESTAMP WITH TIME ZONE,
  motivo_perda TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. Follow-ups
CREATE TABLE public.follow_ups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- retorno, confirmacao, reativacao
  data_agendada TIMESTAMP WITH TIME ZONE NOT NULL,
  data_conclusao TIMESTAMP WITH TIME ZONE,
  nota TEXT,
  status TEXT DEFAULT 'pendente', -- pendente, concluido, cancelado
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 4. Attendants (Optional link or just use profiles)
-- For simplicity, we'll assume atendentes are profiles with a specific role, 
-- but sometimes a clinic has specific "commercial" users.
CREATE TABLE public.atendentes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  ativo BOOLEAN DEFAULT true,
  meta_mensal DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 5. CRM Atendimentos (Logs of interactions)
CREATE TABLE public.crm_atendimentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  atendente_id UUID NOT NULL REFERENCES public.atendentes(id),
  tipo TEXT, -- mensagem, ligacao, presencial
  resumo TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 6. Origins / Configurations
CREATE TABLE public.origens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  nome TEXT NOT NULL, -- Meta Ads, Google Ads, etc.
  slug TEXT NOT NULL,
  cor TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.funis TO authenticated;
GRANT ALL ON public.funis TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.etapas TO authenticated;
GRANT ALL ON public.etapas TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_ups TO authenticated;
GRANT ALL ON public.follow_ups TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atendentes TO authenticated;
GRANT ALL ON public.atendentes TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_atendimentos TO authenticated;
GRANT ALL ON public.crm_atendimentos TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.origens TO authenticated;
GRANT ALL ON public.origens TO service_role;

-- RLS
ALTER TABLE public.funis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etapas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atendentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_atendimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.origens ENABLE ROW LEVEL SECURITY;

-- POLICIES (Tenant-based)
CREATE POLICY "Users can see their tenant's funis" ON public.funis FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert their tenant's funis" ON public.funis FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update their tenant's funis" ON public.funis FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete their tenant's funis" ON public.funis FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can see their tenant's etapas" ON public.etapas FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert their tenant's etapas" ON public.etapas FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update their tenant's etapas" ON public.etapas FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete their tenant's etapas" ON public.etapas FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can see their tenant's leads" ON public.leads FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert their tenant's leads" ON public.leads FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update their tenant's leads" ON public.leads FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete their tenant's leads" ON public.leads FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can see their tenant's follow_ups" ON public.follow_ups FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert their tenant's follow_ups" ON public.follow_ups FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update their tenant's follow_ups" ON public.follow_ups FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete their tenant_s follow_ups" ON public.follow_ups FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can see their tenant's atendentes" ON public.atendentes FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert their tenant's atendentes" ON public.atendentes FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update their tenant's atendentes" ON public.atendentes FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete their tenant's atendentes" ON public.atendentes FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can see their tenant's crm_atendimentos" ON public.crm_atendimentos FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert their tenant's crm_atendimentos" ON public.crm_atendimentos FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can see their tenant's origens" ON public.origens FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert their tenant's origens" ON public.origens FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Functions and Triggers for updated_at
CREATE TRIGGER update_funis_updated_at BEFORE UPDATE ON public.funis FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_etapas_updated_at BEFORE UPDATE ON public.etapas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_follow_ups_updated_at BEFORE UPDATE ON public.follow_ups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_atendentes_updated_at BEFORE UPDATE ON public.atendentes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
