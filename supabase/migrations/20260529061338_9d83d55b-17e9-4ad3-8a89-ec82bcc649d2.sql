CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tid text;
BEGIN
  tid := current_setting('app.tenant_id', true);
  IF tid IS NOT NULL AND tid <> '' THEN
    RETURN tid::uuid;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    RETURN (
      SELECT p.tenant_id
      FROM public.profiles p
      WHERE p.id = auth.uid()
      LIMIT 1
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

UPDATE public.profiles
SET is_super_admin = true,
    nome = COALESCE(NULLIF(nome, ''), 'Admin'),
    updated_at = now()
WHERE lower(email) = lower('adm@gmail.com');

UPDATE public.user_roles ur
SET role = 'admin'::public.app_role,
    tenant_id = p.tenant_id
FROM public.profiles p
WHERE ur.user_id = p.id
  AND lower(p.email) = lower('adm@gmail.com');

INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT p.id, 'admin'::public.app_role, p.tenant_id
FROM public.profiles p
WHERE lower(p.email) = lower('adm@gmail.com')
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id
  );