-- ═══════════════════════════════════════════════════════════
-- Odonto Connect — Row Level Security (RLS) Enforcement
-- Garantia de isolamento total entre Tenants (Clínicas)
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Funções Auxiliares ────────────────────────────────
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
  BEGIN
    RETURN current_setting('app.tenant_id', true)::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION is_super_admin() RETURNS BOOLEAN AS $$
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

-- ─── 2. Habilitar RLS e Criar Políticas ───────────────────
DO $$
DECLARE
    t TEXT;
    tables_to_isolate TEXT[] := ARRAY[
        'pacientes', 'dentistas', 'agendamentos', 'financeiro', 'tratamentos',
        'orcamentos', 'crm_leads', 'estoque', 'comissoes', 'prontuarios',
        'anamneses', 'attendance_queues', 'attendance_sessions', 'satisfaction_ratings',
        'lead_tags', 'lead_tag_assignments', 'contatos', 'odontogramas',
        'transfer_logs', 'estoque_movimentos', 'tratamento_etapas', 'chat_messages',
        'chat_read_status', 'kanban_movements', 'consultations', 'clinical_reports',
        'push_subscriptions', 'reactivation_rules', 'reactivation_sends',
        'meta_ads_accounts', 'meta_ads_campaigns', 'meta_ads_insights',
        'user_preferences', 'fin_bank_accounts', 'fin_employees', 'fin_payrolls',
        'fin_bills', 'fin_movements', 'fin_overdue'
    ];
BEGIN
    FOREACH t IN ARRAY tables_to_isolate
    LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t AND table_schema = 'public') THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE', t);
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(tenant_id)', t || '_tenant_rls_idx', t);
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
            EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', t);

            EXECUTE format('
                CREATE POLICY tenant_isolation_policy ON %I
                FOR ALL
                USING (is_super_admin() OR tenant_id = get_current_tenant_id())
                WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id())
            ', t);
        END IF;
    END LOOP;
END $$;

-- ─── 3. Exceções: Tabelas Globais ou Compartilhadas ───────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self_view ON tenants;
CREATE POLICY tenant_self_view ON tenants FOR SELECT USING (is_super_admin() OR id = get_current_tenant_id());

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_read_all ON plans;
CREATE POLICY plans_read_all ON plans FOR SELECT USING (true);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_tenant_isolation ON profiles;
CREATE POLICY profiles_tenant_isolation ON profiles FOR ALL USING (is_super_admin() OR tenant_id = get_current_tenant_id());

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_settings_read_all ON system_settings;
CREATE POLICY system_settings_read_all ON system_settings FOR SELECT USING (true);
