/**
 * Route access control — single source of truth
 * undefined roles = accessible to everyone
 */

export type AppRole = "admin" | "dentista" | "recepcionista" | "comercial" | "user";

/** Routes restricted to specific roles. Unlisted routes are public to all authenticated users. */
export const routeRoleMap: Record<string, AppRole[]> = {
  "/dentistas": ["admin"],
  "/prontuario": ["admin", "dentista"],
  "/tratamentos": ["admin", "dentista"],
  "/crm": ["admin", "recepcionista", "comercial"],
  "/funil": ["admin", "comercial"],
  "/automacoes": ["admin"],
  "/disparos": ["admin"],
  "/reativacao": ["admin", "recepcionista", "comercial"],
  "/campanhas": ["admin"],
  "/integracoes": ["admin"],
  "/analytics": ["admin"],
  "/financeiro": ["admin"],
  "/comissoes": ["admin"],
  "/estoque": ["admin", "recepcionista"],
  "/canais": ["admin"],
  "/equipe": ["admin"],
  "/configuracoes": ["admin"],
  "/painel-dentista": ["admin", "dentista"],
  "/painel-comercial": ["admin", "comercial"],
  "/pacientes": ["admin", "dentista", "recepcionista", "comercial"],
  "/agenda": ["admin", "dentista", "recepcionista", "comercial"],
};

export function canAccessRoute(path: string, role: string): boolean {
  const allowedRoles = routeRoleMap[path];
  if (!allowedRoles) return true; // no restriction
  return allowedRoles.includes(role as AppRole);
}
