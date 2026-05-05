-- ═══════════════════════════════════════════════════════════
-- Odonto Connect — SaaS Multi-Tenant Migration (Phase 1)
-- Run: psql -U odonto_user -d odonto_db -f migration-saas.sql
-- Idempotente. Roda múltiplas vezes sem efeito.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Tenants (Clínicas) ────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,                       -- nome da clínica
  slug TEXT UNIQUE NOT NULL,                -- usado em URLs
  cnpj TEXT,
  telefone TEXT,
  email_contato TEXT,
  status TEXT NOT NULL DEFAULT 'trial'      -- trial | active | past_due | suspended | canceled
    CHECK (status IN ('trial','active','past_due','suspended','canceled')),
  trial_ends_at TIMESTAMPTZ,
  plan_id UUID,
  current_period_end TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants(status);

-- ─── 2. Plans ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  descricao TEXT,
  preco_mensal NUMERIC(12,2) NOT NULL DEFAULT 0,
  preco_anual NUMERIC(12,2),
  trial_days INTEGER NOT NULL DEFAULT 14,
  -- Limites por plano (NULL = ilimitado)
  max_usuarios INTEGER,
  max_dentistas INTEGER,
  max_pacientes INTEGER,
  max_whatsapp_instances INTEGER,
  features JSONB DEFAULT '{}'::jsonb,       -- ex: {"meta_ads": true, "clinicorp": true}
  ativo BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- FK plan_id após plans existir
DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT tenants_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 3. Subscriptions (histórico de cobranças) ────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','canceled','past_due','expired')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  gateway TEXT,                              -- 'efi' | 'asaas' | 'stripe' | 'manual'
  gateway_subscription_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS subscriptions_tenant_idx ON subscriptions(tenant_id);

-- ─── 4. Invoices (faturas / cobranças) ────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'BRL',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','refunded','canceled')),
  due_date DATE,
  paid_at TIMESTAMPTZ,
  gateway TEXT,
  gateway_charge_id TEXT,
  payment_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices(tenant_id);

-- ─── 5. Super-admin (escopo SaaS, distinto de admin de tenant) ─
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS profiles_tenant_idx ON profiles(tenant_id);

-- ─── 6. Tenant 'legado' + atribuir dados existentes ───────
-- Cria tenant Legado se não existir
INSERT INTO tenants (id, nome, slug, status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Legado', 'legado', 'active', NOW() + INTERVAL '100 years')
ON CONFLICT (id) DO NOTHING;

-- Atribui todos os profiles sem tenant ao Legado
UPDATE profiles SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

-- Adiciona tenant_id nas tabelas operacionais principais (idempotente)
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'pacientes','dentistas','agendamentos','financeiro','tratamentos'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE', t);
      EXECUTE format('UPDATE %I SET tenant_id = ''00000000-0000-0000-0000-000000000001'' WHERE tenant_id IS NULL', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(tenant_id)', t || '_tenant_idx', t);
    END IF;
  END LOOP;
END $$;

-- ─── 7. Planos default ────────────────────────────────────
INSERT INTO plans (slug, nome, descricao, preco_mensal, preco_anual, trial_days, max_usuarios, max_dentistas, max_pacientes, max_whatsapp_instances, features, display_order)
VALUES
  ('starter', 'Starter', 'Para clínicas pequenas começando agora', 197.00, 1970.00, 14, 3, 2, 500, 1,
   '{"clinicorp": false, "meta_ads": false, "ia_avancada": false}'::jsonb, 1),
  ('pro', 'Profissional', 'Para clínicas em crescimento', 397.00, 3970.00, 14, 10, 8, 5000, 3,
   '{"clinicorp": true, "meta_ads": true, "ia_avancada": false}'::jsonb, 2),
  ('enterprise', 'Enterprise', 'Para grandes clínicas e redes', 897.00, 8970.00, 14, NULL, NULL, NULL, NULL,
   '{"clinicorp": true, "meta_ads": true, "ia_avancada": true}'::jsonb, 3)
ON CONFLICT (slug) DO NOTHING;

-- ─── 8. Marca primeiro super-admin (opcional) ─────────────
-- Se houver um profile admin@odontoconnect.tech, vira super_admin.
UPDATE profiles SET is_super_admin = true
WHERE email = 'admin@odontoconnect.tech' AND is_super_admin = false;
