/**
 * Route access control — single source of truth
 * undefined roles = accessible to everyone
 */

export type AppRole = "admin" | "dentista" | "recepcionista" | "comercial" | "user";

/** Routes restricted to specific roles. Unlisted routes are public to all authenticated users. */
export const routeRoleMap: Record<string, AppRole[]> = {
  "/atendimento": ["admin", "dentista"],
  "/dentistas": ["admin"],
  "/prontuario": ["admin", "dentista"],
  "/tratamentos": ["admin", "dentista"],
  "/crm": ["admin", "recepcionista", "comercial"],
  "/automacoes": ["admin"],
  "/disparos": ["admin"],
  "/reativacao": ["admin", "recepcionista", "comercial"],
  "/campanhas": ["admin"],
  "/integracoes": ["admin"],
  "/analytics": ["admin"],
  "/metricas": ["admin", "comercial"],
  "/financeiro": ["admin"],
  "/comissoes": ["admin"],
  "/estoque": ["admin", "recepcionista"],
  "/canais": ["admin"],
  "/equipe": ["admin"],
  "/configuracoes": ["admin"],
  "/minha-assinatura": ["admin"],
  "/usuarios": ["admin"],
  "/super-admin": ["admin"],
  "/painel-dentista": ["admin", "dentista"],
  "/painel-comercial": ["admin", "comercial"],
  "/pacientes": ["admin", "dentista", "recepcionista", "comercial"],
  "/agenda": ["admin", "dentista", "recepcionista", "comercial"],
};

export function canAccessRoute(path: string, role: string, isSuperAdmin?: boolean): boolean {
  // Super Admin can access everything
  if (isSuperAdmin) return true;

  const allowedRoles = routeRoleMap[path];
  
  // Specific check for /super-admin: MUST be isSuperAdmin (handled above)
  if (path === "/super-admin") return false;

  if (!allowedRoles) return true; // no restriction
  return allowedRoles.includes(role as AppRole);
}
