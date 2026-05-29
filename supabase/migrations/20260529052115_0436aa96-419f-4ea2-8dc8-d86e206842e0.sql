-- Update current_tenant_id to be robust for VPS and Supabase
CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  tid text;
BEGIN
  -- 1. Try session variable (VPS style)
  tid := current_setting('app.tenant_id', true);
  IF tid IS NOT NULL AND tid <> '' THEN
    RETURN tid::uuid;
  END IF;
  
  -- 2. Fallback to profiles table via auth.uid() (Supabase style)
  RETURN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid());
EXCEPTION WHEN OTHERS THEN
  RETURN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid());
END;
$function$;

-- Update is_super_admin() without args is already robust, but let's ensure it's correct
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
AS $function$
  DECLARE
    payload TEXT;
    simple_check TEXT;
  BEGIN
    -- 1. Check simple session variable first (set by VPS)
    simple_check := current_setting('app.is_super_admin', true);
    IF simple_check = 'true' THEN
      RETURN TRUE;
    END IF;

    -- 2. Fallback to JWT payload
    payload := current_setting('app.jwt_payload', true);
    IF payload IS NOT NULL AND payload <> '' THEN
      RETURN (payload::jsonb->>'is_super_admin')::boolean;
    END IF;

    -- 3. Fallback to profile check if auth.uid() is available
    IF auth.uid() IS NOT NULL THEN
      RETURN COALESCE((SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()), FALSE);
    END IF;

    RETURN FALSE;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;
$function$;

-- Update policies to use the parameterless is_super_admin() for universal compatibility
-- chat_messages
DROP POLICY IF EXISTS chat_messages_tenant_isolation ON chat_messages;
CREATE POLICY "chat_messages_tenant_isolation" ON chat_messages
FOR ALL
TO authenticated
USING (tenant_id = current_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- crm_leads
DROP POLICY IF EXISTS crm_leads_tenant_isolation ON crm_leads;
CREATE POLICY "crm_leads_tenant_isolation" ON crm_leads
FOR ALL
TO authenticated
USING (tenant_id = current_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- Ensure other tables also have this logic if they use current_tenant_id()
-- You can add more tables here if needed, but these are the main ones for WhatsApp sync.
