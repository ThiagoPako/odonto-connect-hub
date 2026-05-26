
-- 1. Remove public read on app_settings & system_settings
DROP POLICY IF EXISTS app_settings_read_all ON public.app_settings;
DROP POLICY IF EXISTS system_settings_read_all ON public.system_settings;

-- 2. meta_ads_accounts: restrict to admins of the tenant
DROP POLICY IF EXISTS meta_ads_accounts_tenant_isolation ON public.meta_ads_accounts;
CREATE POLICY meta_ads_accounts_admin_only ON public.meta_ads_accounts
  FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid())
    OR (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role))
  )
  WITH CHECK (
    is_super_admin(auth.uid())
    OR (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role))
  );

-- 3. user_roles: scope admin management to same tenant
DROP POLICY IF EXISTS user_roles_manage_admin ON public.user_roles;
CREATE POLICY user_roles_manage_admin ON public.user_roles
  FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid())
    OR (has_role(auth.uid(), 'admin'::app_role) AND tenant_id = current_tenant_id())
  )
  WITH CHECK (
    is_super_admin(auth.uid())
    OR (has_role(auth.uid(), 'admin'::app_role) AND tenant_id = current_tenant_id())
  );

-- 4. Revoke execute on internal trigger function from clients
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
