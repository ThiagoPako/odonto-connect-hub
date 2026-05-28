CREATE OR REPLACE FUNCTION public.backfill_clinicorp_appointments(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. First extract everything we can from raw
  UPDATE clinicorp_appointments SET
    patient_name = COALESCE(NULLIF(patient_name,''), raw->>'PatientName', raw->>'Patient_FullName', raw->>'Patient_Name', raw->'Patient'->>'Name', raw->'Patient'->>'FullName'),
    patient_id = COALESCE(patient_id, NULLIF(regexp_replace(COALESCE(raw->>'Patient_PersonId', raw->>'PatientId', raw->>'PatientPersonId', raw->'Patient'->>'Id', ''), '\D', '', 'g'), '')::bigint),
    professional_id = COALESCE(professional_id, NULLIF(regexp_replace(COALESCE(raw->>'Dentist_PersonId', raw->>'ProfessionalId', raw->>'ScheduleToId', raw->'Dentist'->>'Id', ''), '\D', '', 'g'), '')::bigint),
    professional_name = COALESCE(NULLIF(professional_name,''), raw->>'Dentist_FullName', raw->>'Dentist_Name', raw->>'ScheduleToName', raw->>'ProfessionalName', raw->'Dentist'->>'FullName', raw->'Dentist'->>'Name'),
    category_id = COALESCE(category_id, NULLIF(regexp_replace(COALESCE(raw->>'CategoryId', ''), '\D', '', 'g'), '')::bigint),
    category_description = COALESCE(NULLIF(category_description,''), raw->>'CategoryDescription', raw->>'Category'),
    category_color = COALESCE(NULLIF(category_color,''), raw->>'CategoryColor', raw->>'Color'),
    business_id = COALESCE(business_id, NULLIF(regexp_replace(COALESCE(raw->>'Clinic_BusinessId', raw->>'BusinessId', ''), '\D', '', 'g'), '')::bigint),
    date = COALESCE(date, (raw->>'date')::date, (raw->>'Date')::date),
    from_time = COALESCE(NULLIF(from_time,''), raw->>'fromTime', raw->>'FromTime'),
    to_time = COALESCE(NULLIF(to_time,''), raw->>'toTime', raw->>'ToTime'),
    status = COALESCE(NULLIF(status,''), raw->>'StatusId', raw->>'Status'),
    notes = COALESCE(NULLIF(notes,''), raw->>'Notes', raw->>'notes')
  WHERE tenant_id = p_tenant_id 
    AND raw IS NOT NULL;

  -- 2. Then try to fill professional_name from clinicorp_professionals table
  UPDATE clinicorp_appointments a
  SET professional_name = p.full_name
  FROM clinicorp_professionals p
  WHERE a.tenant_id = p_tenant_id
    AND a.professional_id = p.id
    AND p.tenant_id = p_tenant_id
    AND (a.professional_name IS NULL OR a.professional_name = '' OR a.professional_name LIKE 'Profissional %')
    AND p.full_name IS NOT NULL
    AND p.full_name NOT LIKE 'Profissional %';
END;
$$;
