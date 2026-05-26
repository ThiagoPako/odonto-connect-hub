ALTER TABLE public.clinicorp_user_settings ADD COLUMN IF NOT EXISTS sync_progress JSONB;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinicorp_user_settings TO authenticated;
GRANT ALL ON public.clinicorp_user_settings TO service_role;