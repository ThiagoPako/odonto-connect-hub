-- Migration to add tenant_id to financial tables and fix constraints
-- This ensures multi-tenant isolation for financial data mirroring

DO $$ 
BEGIN
    -- 1. clinicorp_financial_entries
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinicorp_financial_entries' AND column_name = 'tenant_id') THEN
        ALTER TABLE clinicorp_financial_entries ADD COLUMN tenant_id UUID;
    END IF;

    -- Update existing records if possible (using the first admin tenant found)
    UPDATE clinicorp_financial_entries SET tenant_id = (SELECT tenant_id FROM profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1) WHERE tenant_id IS NULL;

    -- 2. clinicorp_monthly_summary
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinicorp_monthly_summary' AND column_name = 'tenant_id') THEN
        ALTER TABLE clinicorp_monthly_summary ADD COLUMN tenant_id UUID;
    END IF;

    -- Update existing records
    UPDATE clinicorp_monthly_summary SET tenant_id = (SELECT tenant_id FROM profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1) WHERE tenant_id IS NULL;

    -- 3. Adjust constraints for clinicorp_financial_entries
    ALTER TABLE clinicorp_financial_entries DROP CONSTRAINT IF EXISTS clinicorp_financial_entries_source_external_id_key;
    -- Note: We use a unique index for (source, external_id, tenant_id) to allow same external_id for different tenants
    -- However, often external_id from Clinicorp is globally unique. To be safe:
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_clinicorp_financial_entries_tenant_ext') THEN
        CREATE UNIQUE INDEX idx_clinicorp_financial_entries_tenant_ext ON clinicorp_financial_entries(source, external_id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));
    END IF;

    -- 4. Adjust constraints for clinicorp_monthly_summary
    ALTER TABLE clinicorp_monthly_summary DROP CONSTRAINT IF EXISTS clinicorp_monthly_summary_source_period_month_business_id_key;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_clinicorp_monthly_summary_tenant_period') THEN
        CREATE UNIQUE INDEX idx_clinicorp_monthly_summary_tenant_period ON clinicorp_monthly_summary(source, period_month, business_id, tenant_id);
    END IF;

END $$;
