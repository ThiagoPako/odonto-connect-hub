-- 1. Limpeza total de qualquer estado anterior para este email
DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'adm@gmail.com');
DELETE FROM public.profiles WHERE email = 'adm@gmail.com';
DELETE FROM public.tenants WHERE email_contato = 'adm@gmail.com';
DELETE FROM auth.users WHERE email = 'adm@gmail.com';

-- 2. Criar apenas no auth.users
-- O trigger 'on_auth_user_created' cuidará de criar:
--   - O tenant (Clínica Admin)
--   - O profile (Admin)
--   - A role (admin)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'adm@gmail.com', crypt('adm102030', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"nome": "Admin"}', now(), now(), '', '', '', ''
);

-- 3. Agora, elevar para Super Admin manualmente
UPDATE public.profiles
SET is_super_admin = true
WHERE email = 'adm@gmail.com';