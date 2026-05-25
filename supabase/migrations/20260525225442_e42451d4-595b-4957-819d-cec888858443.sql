-- ═══════════════════════════════════════════════════════════
-- FUNDAÇÃO SAAS — Tenants, Plans, Profiles, Roles
-- ═══════════════════════════════════════════════════════════

-- 1. Enum de papéis
CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'manager', 'dentist', 'reception', 'user');

-- 2. Plans
CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  descricao TEXT,
  preco_mensal NUMERIC(12,2) NOT NULL DEFAULT 0,
  preco_anual NUMERIC(12,2),
  trial_days INTEGER NOT NULL DEFAULT 14,
  max_usuarios INTEGER,
  max_dentistas INTEGER,
  max_pacientes INTEGER,
  max_whatsapp_instances INTEGER,
  features JSONB DEFAULT '{}'::jsonb,
  ativo BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tenants
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  cnpj TEXT,
  telefone TEXT,
  email_contato TEXT,
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','suspended','canceled')),
  trial_ends_at TIMESTAMPTZ,
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  current_period_end TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX tenants_status_idx ON public.tenants(status);

-- 4. Profiles (ligado a auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome TEXT,
  email TEXT,
  avatar_url TEXT,
  is_super_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX profiles_tenant_idx ON public.profiles(tenant_id);

-- 5. User Roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, role, tenant_id)
);
CREATE INDEX user_roles_user_idx ON public.user_roles(user_id);

-- 6. Subscriptions
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','past_due','expired')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  gateway TEXT,
  gateway_subscription_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX subscriptions_tenant_idx ON public.subscriptions(tenant_id);

-- 7. Invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'BRL',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','canceled')),
  due_date DATE,
  paid_at TIMESTAMPTZ,
  gateway TEXT,
  gateway_charge_id TEXT,
  payment_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX invoices_tenant_idx ON public.invoices(tenant_id);

-- ═══════════════════════════════════════════════════════════
-- FUNÇÕES SECURITY DEFINER (evitam recursão em RLS)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_super_admin FROM public.profiles WHERE id = _user_id), false)
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ═══════════════════════════════════════════════════════════
-- TRIGGER: cria profile automaticamente ao registrar usuário
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nome)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════
-- TRIGGER: atualiza updated_at
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER plans_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- PLANS: leitura para todos os logados; escrita só super-admin
CREATE POLICY "plans_select_authenticated" ON public.plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "plans_all_super_admin" ON public.plans FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- TENANTS: usuário vê só a sua clínica; super-admin vê todas
CREATE POLICY "tenants_select_own" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));
CREATE POLICY "tenants_update_admin" ON public.tenants FOR UPDATE TO authenticated
  USING ((id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin')) OR public.is_super_admin(auth.uid()));
CREATE POLICY "tenants_insert_super_admin" ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "tenants_delete_super_admin" ON public.tenants FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- PROFILES: vê próprio + colegas da clínica; edita só o próprio
CREATE POLICY "profiles_select_same_tenant" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.is_super_admin(auth.uid()));

-- USER_ROLES: só super-admin e admin do tenant gerenciam; usuário vê os seus
CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));
CREATE POLICY "user_roles_manage_admin" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

-- SUBSCRIPTIONS: vê a do tenant; só admin/super-admin edita
CREATE POLICY "subscriptions_select_tenant" ON public.subscriptions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));
CREATE POLICY "subscriptions_manage_admin" ON public.subscriptions FOR ALL TO authenticated
  USING ((tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin')) OR public.is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin')) OR public.is_super_admin(auth.uid()));

-- INVOICES: vê do tenant; só admin/super-admin edita
CREATE POLICY "invoices_select_tenant" ON public.invoices FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));
CREATE POLICY "invoices_manage_admin" ON public.invoices FOR ALL TO authenticated
  USING ((tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin')) OR public.is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin')) OR public.is_super_admin(auth.uid()));

-- ═══════════════════════════════════════════════════════════
-- SEEDS: Planos padrão + Tenant Legado
-- ═══════════════════════════════════════════════════════════

INSERT INTO public.plans (slug, nome, descricao, preco_mensal, preco_anual, trial_days, max_usuarios, max_dentistas, max_pacientes, max_whatsapp_instances, features, display_order) VALUES
  ('starter', 'Starter', 'Para clínicas pequenas começando agora', 197.00, 1970.00, 14, 3, 2, 500, 1, '{"clinicorp": false, "meta_ads": false, "ia_avancada": false}'::jsonb, 1),
  ('pro', 'Profissional', 'Para clínicas em crescimento', 397.00, 3970.00, 14, 10, 8, 5000, 3, '{"clinicorp": true, "meta_ads": true, "ia_avancada": false}'::jsonb, 2),
  ('enterprise', 'Enterprise', 'Para grandes clínicas e redes', 897.00, 8970.00, 14, NULL, NULL, NULL, NULL, '{"clinicorp": true, "meta_ads": true, "ia_avancada": true}'::jsonb, 3);

INSERT INTO public.tenants (id, nome, slug, status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Legado', 'legado', 'active', NOW() + INTERVAL '100 years');