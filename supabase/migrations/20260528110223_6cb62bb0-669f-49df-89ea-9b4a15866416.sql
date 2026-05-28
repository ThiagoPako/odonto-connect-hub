-- Promote user to Super Admin
UPDATE public.profiles 
SET is_super_admin = true
WHERE email = 'ag.pulsemkt@gmail.com';

-- Ensure user has admin role in user_roles
-- We use a subquery to avoid unique constraint issues if possible
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles ur 
        JOIN public.profiles p ON p.id = ur.user_id 
        WHERE p.email = 'ag.pulsemkt@gmail.com' AND ur.role = 'admin'
    ) THEN
        INSERT INTO public.user_roles (user_id, role, tenant_id)
        SELECT p.id, 'admin', p.tenant_id 
        FROM public.profiles p 
        WHERE p.email = 'ag.pulsemkt@gmail.com';
    END IF;
END $$;

-- Assign existing 'starter' plan to the existing tenant if not set
UPDATE public.tenants 
SET plan_id = (SELECT id FROM public.plans WHERE slug = 'starter' LIMIT 1)
WHERE plan_id IS NULL;
