ALTER TABLE public.agendamentos ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE public.agendamentos ADD COLUMN IF NOT EXISTS categoria_cor TEXT;

-- Garantir permissões
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agendamentos TO authenticated;
GRANT ALL ON public.agendamentos TO service_role;