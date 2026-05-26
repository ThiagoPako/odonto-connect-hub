ALTER TABLE public.pacientes ADD COLUMN IF NOT EXISTS clinicorp_patient_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pacientes_clinicorp_id ON public.pacientes(clinicorp_patient_id);