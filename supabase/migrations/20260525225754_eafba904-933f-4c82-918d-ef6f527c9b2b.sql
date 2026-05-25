
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_tenant_id UUID;
  user_nome TEXT;
BEGIN
  user_nome := COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));

  -- Cria uma nova clínica para o usuário
  INSERT INTO public.tenants (nome, slug, status, trial_ends_at, email_contato)
  VALUES (
    'Clínica ' || user_nome,
    'clinica-' || substr(NEW.id::text, 1, 8),
    'trial',
    now() + interval '14 days',
    NEW.email
  )
  RETURNING id INTO new_tenant_id;

  -- Cria o profile já vinculado ao tenant
  INSERT INTO public.profiles (id, email, nome, tenant_id)
  VALUES (NEW.id, NEW.email, user_nome, new_tenant_id);

  -- Atribui papel de admin
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (NEW.id, 'admin'::app_role, new_tenant_id);

  RETURN NEW;
END;
$function$;

-- Garante que o trigger existe
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
