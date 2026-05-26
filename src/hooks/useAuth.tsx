import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  tenant_id: string | null;
  is_super_admin: boolean;
  tenant_features?: Record<string, boolean>;
}

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadUserFromSession(session: Session): Promise<AuthUser | null> {
  const authUser = session.user;
  if (!authUser) return null;

  // Fetch profile (created by handle_new_user trigger)
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, nome, email, tenant_id, is_super_admin, avatar_url")
    .eq("id", authUser.id)
    .maybeSingle();

  // Fetch role from user_roles (separate table, prevents privilege escalation)
  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", authUser.id)
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Fetch tenant feature flags (optional)
  let tenant_features: Record<string, boolean> = {};
  if (profile?.tenant_id) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("features")
      .eq("id", profile.tenant_id)
      .maybeSingle();
    if (tenant?.features && typeof tenant.features === "object") {
      tenant_features = tenant.features as Record<string, boolean>;
    }
  }

  return {
    id: authUser.id,
    email: profile?.email ?? authUser.email ?? "",
    name: profile?.nome ?? (authUser.user_metadata?.nome as string) ?? authUser.email ?? "",
    role: (roleRow?.role as string) ?? "user",
    avatar_url: profile?.avatar_url ?? null,
    tenant_id: profile?.tenant_id ?? null,
    is_super_admin: !!profile?.is_super_admin,
    tenant_features,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Listener FIRST (must not call async supabase methods synchronously inside)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session) {
        // defer DB calls to avoid deadlock inside the auth callback
        setTimeout(() => {
          loadUserFromSession(session).then((u) => {
            if (mounted) setUser(u);
          });
        }, 0);
      } else {
        setUser(null);
      }
    });

    // THEN check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session) {
        loadUserFromSession(session).then((u) => {
          if (mounted) {
            setUser(u);
            setIsLoading(false);
          }
        });
      } else {
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    // user state will be populated by onAuthStateChange
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!user,
        user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
