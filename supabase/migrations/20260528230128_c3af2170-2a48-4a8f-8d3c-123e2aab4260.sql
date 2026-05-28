-- Function to backfill appointment columns from raw JSONB
CREATE OR REPLACE FUNCTION public.backfill_clinicorp_appointments(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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
    AND raw IS NOT NULL
    AND (patient_name IS NULL OR patient_name='' OR patient_id IS NULL OR from_time IS NULL OR date IS NULL OR professional_id IS NULL);
END;
$$;

-- Function to derive patients from appointment raws
CREATE OR REPLACE FUNCTION public.backfill_clinicorp_patients(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO clinicorp_patients (id, tenant_id, name, mobile_phone, raw, synced_at)
  SELECT DISTINCT ON (pid)
    pid::bigint AS id,
    p_tenant_id as tenant_id,
    NULLIF(raw->>'PatientName',''),
    NULLIF(raw->>'MobilePhone',''),
    jsonb_build_object('derived_from','appointment_backfill','id',pid,'name',raw->>'PatientName','mobile_phone',raw->>'MobilePhone'),
    NOW()
  FROM (
    SELECT raw,
           NULLIF(regexp_replace(COALESCE(raw->>'Patient_PersonId', raw->>'PatientId',''), '\D', '', 'g'), '') AS pid
    FROM clinicorp_appointments
    WHERE tenant_id = p_tenant_id AND raw IS NOT NULL
  ) s
  WHERE pid IS NOT NULL AND pid ~ '^\d+$'
  ON CONFLICT (id, tenant_id) DO UPDATE SET
    name = COALESCE(NULLIF(EXCLUDED.name,''), clinicorp_patients.name),
    mobile_phone = COALESCE(NULLIF(EXCLUDED.mobile_phone,''), clinicorp_patients.mobile_phone),
    synced_at = NOW();
END;
$$;

-- Function to fix generic professional names
CREATE OR REPLACE FUNCTION public.fix_generic_professionals(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update professionals table from appointment names if they match generic pattern
  UPDATE clinicorp_professionals p
  SET full_name = a.professional_name
  FROM (
    SELECT DISTINCT ON (professional_id) professional_id, professional_name
    FROM clinicorp_appointments
    WHERE tenant_id = p_tenant_id 
      AND professional_name IS NOT NULL 
      AND professional_name != '' 
      AND professional_name NOT LIKE 'Profissional %'
  ) a
  WHERE p.tenant_id = p_tenant_id 
    AND p.id = a.professional_id
    AND (p.full_name IS NULL OR p.full_name = '' OR p.full_name LIKE 'Profissional %');

  -- Also update the dentistas table (local table)
  UPDATE dentistas d
  SET nome = p.full_name
  FROM clinicorp_professionals p
  WHERE d.tenant_id = p_tenant_id 
    AND d.clinicorp_professional_id = p.id
    AND p.tenant_id = p_tenant_id
    AND (d.nome IS NULL OR d.nome = '' OR d.nome LIKE 'Profissional %');
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_clinicorp_appointments(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_clinicorp_patients(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fix_generic_professionals(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_clinicorp_appointments(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_clinicorp_patients(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fix_generic_professionals(UUID) TO service_role;
