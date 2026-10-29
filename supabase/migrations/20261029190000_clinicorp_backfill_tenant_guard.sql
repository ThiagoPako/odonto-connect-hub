-- As funções de backfill da Clinicorp são SECURITY DEFINER e recebem
-- p_tenant_id livre: qualquer usuário logado podia alterar dados de outra
-- clínica. Elas deixam de ser chamáveis direto pelo app; o app passa a usar
-- clinicorp_run_backfill(), que sempre usa a clínica do próprio usuário.

REVOKE EXECUTE ON FUNCTION public.backfill_clinicorp_appointments(UUID) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.backfill_clinicorp_patients(UUID) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.fix_generic_professionals(UUID) FROM authenticated, anon, public;

CREATE OR REPLACE FUNCTION public.clinicorp_run_backfill()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário sem clínica vinculada';
  END IF;

  PERFORM public.backfill_clinicorp_appointments(v_tenant);
  PERFORM public.backfill_clinicorp_patients(v_tenant);
  PERFORM public.fix_generic_professionals(v_tenant);

  RETURN jsonb_build_object(
    'ok', true,
    'appointments', (SELECT count(*) FROM clinicorp_appointments WHERE tenant_id = v_tenant),
    'patients', (SELECT count(*) FROM clinicorp_patients WHERE tenant_id = v_tenant),
    'professionals', (SELECT count(*) FROM clinicorp_professionals WHERE tenant_id = v_tenant)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clinicorp_run_backfill() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.clinicorp_run_backfill() TO authenticated, service_role;
