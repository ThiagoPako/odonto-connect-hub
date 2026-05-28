-- Fix unique constraints for UPSERT in mirror tables

-- clinicorp_financial_entries
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinicorp_financial_entries_unique_key') THEN
        ALTER TABLE public.clinicorp_financial_entries 
        ADD CONSTRAINT clinicorp_financial_entries_unique_key UNIQUE (source, external_id, tenant_id);
    END IF;
END $$;

-- clinicorp_monthly_summary
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinicorp_monthly_summary_unique_key') THEN
        ALTER TABLE public.clinicorp_monthly_summary 
        ADD CONSTRAINT clinicorp_monthly_summary_unique_key UNIQUE (source, period_month, business_id, tenant_id);
    END IF;
END $$;

-- Ensure clinicorp_estimates has the right unique constraint if not already primary key
-- (It already has clinicorp_estimates_pkey on (id, tenant_id) from previous check)

-- Ensure clinicorp_patients has unique constraint on (id, tenant_id)
-- (It already has clinicorp_patients_pkey on (id, tenant_id))

-- Fix for potentially missing or mismatched columns
ALTER TABLE public.clinicorp_patients ADD COLUMN IF NOT EXISTS document_id TEXT;
ALTER TABLE public.clinicorp_patients ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE public.clinicorp_patients ADD COLUMN IF NOT EXISTS sex TEXT;

-- Grant permissions again to be sure
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
