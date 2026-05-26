ALTER TABLE public.pacientes ADD CONSTRAINT pacientes_tenant_clinicorp_id_key UNIQUE (tenant_id, clinicorp_patient_id);
ALTER TABLE public.dentistas ADD CONSTRAINT dentistas_tenant_clinicorp_id_key UNIQUE (tenant_id, clinicorp_professional_id);
ALTER TABLE public.agendamentos ADD CONSTRAINT agendamentos_tenant_clinicorp_id_key UNIQUE (tenant_id, clinicorp_appointment_id);