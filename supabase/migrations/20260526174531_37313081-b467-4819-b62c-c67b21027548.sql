REVOKE EXECUTE ON FUNCTION public.handle_procedimento_versioning() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_procedimento_versioning() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.handle_procedimento_versioning() TO service_role;
-- The trigger itself runs with the owner's privileges (SECURITY DEFINER) but we want to prevent direct execution.
