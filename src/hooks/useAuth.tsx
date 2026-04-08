import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { getToken, setToken as saveToken, clearToken, getMe, login as apiLogin } from "@/lib/vpsApi";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url: string | null;
}

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIsLoading(false);
      return;
    }
    getMe()
      .then((res) => {
        if (res.data) setUser(res.data as AuthUser);
        else clearToken();
      })
      .catch(() => clearToken())
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    if (res.error) throw new Error(res.error);
    if (res.data) {
      const d = res.data as { token: string; user: AuthUser };
      saveToken(d.token);
      setUser(d.user);
    }
  }, []);

  const logout = useCallback(() => {
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
