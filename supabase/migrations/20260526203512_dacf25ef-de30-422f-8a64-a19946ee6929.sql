ALTER TABLE public.clinicorp_webhook_events ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE public.clinicorp_push_log ADD COLUMN IF NOT EXISTS tenant_id UUID;
CREATE INDEX IF NOT EXISTS idx_clinicorp_webhook_events_tenant ON public.clinicorp_webhook_events(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinicorp_push_log_tenant ON public.clinicorp_push_log(tenant_id, created_at DESC);