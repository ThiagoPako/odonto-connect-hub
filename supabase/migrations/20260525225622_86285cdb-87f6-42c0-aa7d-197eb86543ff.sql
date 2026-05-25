
CREATE TABLE public.pacientes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  nome TEXT NOT NULL,
  cpf TEXT,
  rg TEXT,
  data_nascimento DATE,
  sexo TEXT CHECK (sexo IN ('M', 'F', 'O')),
  email TEXT,
  telefone TEXT,
  celular TEXT,
  cep TEXT,
  logradouro TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  convenio TEXT,
  numero_carteira TEXT,
  observacoes TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cpf)
);

CREATE INDEX idx_pacientes_tenant ON public.pacientes(tenant_id);
CREATE INDEX idx_pacientes_nome ON public.pacientes(tenant_id, nome);
CREATE INDEX idx_pacientes_cpf ON public.pacientes(tenant_id, cpf);
CREATE INDEX idx_pacientes_celular ON public.pacientes(tenant_id, celular);

ALTER TABLE public.pacientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pacientes_select_tenant" ON public.pacientes
FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "pacientes_insert_tenant" ON public.pacientes
FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "pacientes_update_tenant" ON public.pacientes
FOR UPDATE TO authenticated
USING (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()))
WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "pacientes_delete_admin" ON public.pacientes
FOR DELETE TO authenticated
USING (
  (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::app_role))
  OR public.is_super_admin(auth.uid())
);

CREATE TRIGGER update_pacientes_updated_at
BEFORE UPDATE ON public.pacientes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
