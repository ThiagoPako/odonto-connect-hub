import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { login as loginVps, clearToken } from "@/lib/vpsApi";

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
  refreshUser: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadUserFromSession(session: Session): Promise<AuthUser | null> {
  const authUser = session.user;
  if (!authUser) return null;

  // Fetch profile (created by handle_new_user trigger)
  // Important: never silently downgrade to "user" when permission reads fail.
  // If the database/policy query errors, keep the app in an auth-loading/error
  // path instead of rendering a limited menu for an admin account.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, nome, email, tenant_id, is_super_admin, avatar_url")
    .eq("id", authUser.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Erro ao carregar perfil: ${profileError.message}`);
  }

  // Fetch role from user_roles (separate table, prevents privilege escalation)
  const { data: roleRow, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", authUser.id)
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (roleError) {
    throw new Error(`Erro ao carregar permissões: ${roleError.message}`);
  }

  // Fetch tenant feature flags from metadata jsonb (optional)
  let tenant_features: Record<string, boolean> = {};
  if (profile?.tenant_id) {
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("metadata")
      .eq("id", profile.tenant_id)
      .maybeSingle();
    if (tenantError) {
      throw new Error(`Erro ao carregar recursos da clínica: ${tenantError.message}`);
    }
    const meta = tenant?.metadata as { features?: Record<string, boolean> } | null;
    if (meta?.features && typeof meta.features === "object") {
      tenant_features = meta.features;
    }
  }

  const isSuperAdmin = !!profile?.is_super_admin;
  const role = isSuperAdmin ? "admin" : ((roleRow?.role as string) ?? "user");

  return {
    id: authUser.id,
    email: profile?.email ?? authUser.email ?? "",
    name: profile?.nome ?? (authUser.user_metadata?.nome as string) ?? authUser.email ?? "",
    role,
    avatar_url: profile?.avatar_url ?? null,
    tenant_id: profile?.tenant_id ?? null,
    is_super_admin: isSuperAdmin,
    tenant_features,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setUser(null);
      return null;
    }

    const freshUser = await loadUserFromSession(session);
    setUser(freshUser);
    return freshUser;
  }, []);

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
          }).catch((error) => {
            console.error("Failed to refresh authenticated user", error);
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
        }).catch((error) => {
          console.error("Failed to load authenticated user", error);
          if (mounted) {
            setUser(null);
            setIsLoading(false);
          }
        });
      } else {
        setIsLoading(false);
      }
    });

    const refreshOnFocus = () => {
      if (!mounted) return;
      refreshUser().catch(() => undefined);
    };
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") refreshOnFocus();
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);

    return () => {
      mounted = false;
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
      subscription.unsubscribe();
    };
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    await loginVps(email, password).catch((err) => {
      console.warn("VPS legacy login bridge failed", err);
    });
    if (data.session) {
      const freshUser = await loadUserFromSession(data.session);
      setUser(freshUser);
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    clearToken();
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
        refreshUser,
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
