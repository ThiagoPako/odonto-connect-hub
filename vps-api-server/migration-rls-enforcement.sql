-- ═══════════════════════════════════════════════════════════
-- Odonto Connect — Row Level Security (RLS) Enforcement
-- Garantia de isolamento total entre Tenants (Clínicas)
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Função Auxiliar para Tenant ID ────────────────────
-- Captura o tenant_id da sessão ou do JWT (via middleware VPS)
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
  -- Tenta pegar da variável de sessão 'app.tenant_id' configurada pelo server.mjs
  SELECT current_setting('app.tenant_id', true)::UUID;
$$ LANGUAGE sql STABLE;

-- ─── 2. Habilitar RLS e Criar Políticas ───────────────────
DO $$
DECLARE
    t TEXT;
    tables_to_isolate TEXT[] := ARRAY[
        'pacientes',
        'dentistas',
        'agendamentos',
        'financeiro',
        'tratamentos',
        'orcamentos',
        'crm_leads',
        'estoque',
        'comissoes',
        'prontuarios',
        'anamneses',
        'attendance_queues',
        'attendance_sessions',
        'satisfaction_ratings',
        'lead_tags',
        'lead_tag_assignments',
        'contatos',
        'odontogramas',
        'transfer_logs',
        'estoque_movimentos',
        'tratamento_etapas',
        'chat_messages',
        'chat_read_status',
        'kanban_movements',
        'consultations',
        'clinical_reports',
        'push_subscriptions',
        'reactivation_rules',
        'reactivation_sends',
        'meta_ads_accounts',
        'meta_ads_campaigns',
        'meta_ads_insights',
        'user_preferences',
        'fin_bank_accounts',
        'fin_employees',
        'fin_payrolls',
        'fin_bills',
        'fin_movements',
        'fin_overdue'
    ];
BEGIN
    FOREACH t IN ARRAY tables_to_isolate
    LOOP
        -- 1. Garante que a coluna tenant_id existe (idempotente)
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t AND table_schema = 'public') THEN
            
            -- Adiciona tenant_id se não existir
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE', t);
            
            -- Cria índice para performance se não existir
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(tenant_id)', t || '_tenant_rls_idx', t);

            -- 2. Habilita RLS na tabela
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

            -- 3. Remove políticas antigas para evitar duplicidade ou conflitos
            EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', t);

            -- 4. Cria a política unificada: 
            -- Usuários só veem/editam dados do seu próprio tenant_id
            -- Super admins (vps_api) não são afetados pois o server.mjs usa o dono do banco ou Bypass RLS se necessário,
            -- mas aqui restringimos ao tenant_id setado na sessão.
            EXECUTE format('
                CREATE POLICY tenant_isolation_policy ON %I
                FOR ALL
                USING (tenant_id = get_current_tenant_id())
                WITH CHECK (tenant_id = get_current_tenant_id())
            ', t);

            RAISE NOTICE 'RLS habilitado e política aplicada para a tabela: %', t;
        ELSE
            RAISE WARNING 'Tabela % não encontrada, pulando...', t;
        END IF;
    END LOOP;
END $$;

-- ─── 3. Exceções: Tabelas Globais ou Compartilhadas ───────
-- 'tenants': Cada um só vê o seu próprio registro
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self_view ON tenants;
CREATE POLICY tenant_self_view ON tenants
    FOR SELECT
    USING (id = get_current_tenant_id());

-- 'plans': Todos podem ver os planos (Leitura Global)
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_read_all ON plans;
CREATE POLICY plans_read_all ON plans FOR SELECT USING (true);

-- 'profiles': Cada um só vê os usuários do seu tenant
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_tenant_isolation ON profiles;
CREATE POLICY profiles_tenant_isolation ON profiles
    FOR ALL
    USING (tenant_id = get_current_tenant_id() OR is_super_admin = true);

-- 'system_settings' e 'ai_settings': Geralmente são globais do sistema (SaaS-wide) ou por tenant?
-- Se forem globais, apenas Super Admins editam. Aqui vamos assumir globais para o funcionamento do SaaS.
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_settings_read_all ON system_settings;
CREATE POLICY system_settings_read_all ON system_settings FOR SELECT USING (true);

-- ─── 4. Auditoria de Segurança ────────────────────────────
-- Query para verificar o status final (rodar após a migração):
/*
SELECT 
    relname as table_name, 
    relrowsecurity as rls_enabled, 
    relforcrowsecurity as rls_forced 
FROM pg_class 
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace 
WHERE nspname = 'public' AND relkind = 'r';
*/
