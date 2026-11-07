import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { canAccessRoute } from "@/lib/routeAccess";

/**
 * Diz se o usuário logado pode abrir uma rota (mesma regra do menu e do guarda de rota).
 * Use para esconder botões/links que levariam à tela "Acesso negado".
 */
export function usePodeAcessar() {
  const { user } = useAuth();
  return useCallback(
    (path: string) => !!user && canAccessRoute(path, user.role, user.is_super_admin, user.tenant_features),
    [user],
  );
}

/** Papel do usuário logado com atalhos usados nas telas clínicas. */
export function usePapel() {
  const { user } = useAuth();
  const admin = !!user && (user.role === "admin" || user.is_super_admin);
  return { papel: user?.role ?? "", admin, clinico: admin || user?.role === "dentista" };
}
