CREATE OR REPLACE FUNCTION public.fix_generic_professionals(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    AND d.clinicorp_professional_id = p.id::text
    AND p.tenant_id = p_tenant_id
    AND (d.nome IS NULL OR d.nome = '' OR d.nome LIKE 'Profissional %');
END;
$$;
