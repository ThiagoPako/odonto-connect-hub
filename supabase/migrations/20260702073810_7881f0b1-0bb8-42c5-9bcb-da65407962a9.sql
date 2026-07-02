
DO $$
DECLARE
  u RECORD;
  new_tenant_id UUID;
  user_nome TEXT;
BEGIN
  FOR u IN
    SELECT au.id, au.email, au.raw_user_meta_data
      FROM auth.users au
      LEFT JOIN public.profiles p ON p.id = au.id
     WHERE p.id IS NULL
  LOOP
    user_nome := COALESCE(u.raw_user_meta_data->>'nome', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1));

    INSERT INTO public.tenants (nome, slug, status, trial_ends_at, email_contato)
    VALUES (
      'Clínica ' || user_nome,
      'clinica-' || substr(u.id::text, 1, 8),
      'trial',
      now() + interval '14 days',
      u.email
    )
    RETURNING id INTO new_tenant_id;

    INSERT INTO public.profiles (id, email, nome, tenant_id)
    VALUES (u.id, u.email, user_nome, new_tenant_id);

    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (u.id, 'admin'::app_role, new_tenant_id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Garante que o trigger handle_new_user esteja ativo em auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
