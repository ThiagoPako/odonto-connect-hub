import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { getToken, clearToken, getMe, login as loginVps, setCachedTenantId } from "@/lib/vpsApi";

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

/** Lê o usuário completo (papel, clínica, módulos) do /auth/me da VPS. */
async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (!getToken()) return null;
  const { data } = await getMe();
  if (!data) return null;
  const user = data as unknown as AuthUser;
  const resolved: AuthUser = {
    ...user,
    role: user.is_super_admin ? "admin" : user.role || "user",
    tenant_features: user.tenant_features || {},
  };
  setCachedTenantId(resolved.tenant_id);
  return resolved;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const fresh = await fetchCurrentUser();
    setUser(fresh);
    return fresh;
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchCurrentUser()
      .then((u) => { if (mounted) setUser(u); })
      .catch((error) => console.error("Failed to load authenticated user", error))
      .finally(() => { if (mounted) setIsLoading(false); });

    // Reflete mudanças de papel/módulos feitas por um admin sem exigir novo login.
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible" && getToken()) {
        fetchCurrentUser().then((u) => { if (mounted && u) setUser(u); }).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await loginVps(email, password);
    if (error) throw new Error(error);
    const fresh = await fetchCurrentUser();
    if (!fresh) throw new Error("Não foi possível carregar seu perfil.");
    setUser(fresh);
  }, []);

  const logout = useCallback(async () => {
    clearToken();
    setCachedTenantId(null);
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
