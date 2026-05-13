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

export function canAccessRoute(
  path: string, 
  role: string, 
  isSuperAdmin?: boolean, 
  tenantFeatures?: Record<string, boolean>
): boolean {
  // Super Admin can access everything
  if (isSuperAdmin) return true;

  const allowedRoles = routeRoleMap[path];
  
  // Specific check for /super-admin: MUST be isSuperAdmin (handled above)
  if (path === "/super-admin") return false;

  // Feature-based access control
  if (tenantFeatures) {
    if (path === "/financeiro" && tenantFeatures.mod_financeiro === false) return false;
    if (path === "/comissoes" && tenantFeatures.mod_financeiro === false) return false;
    if (path === "/automacoes" && tenantFeatures.mod_marketing === false) return false;
    if (path === "/campanhas" && tenantFeatures.mod_marketing === false) return false;
    if (path === "/whatsapp" && tenantFeatures.mod_whatsapp === false) return false;
    if (path === "/disparos" && tenantFeatures.mod_whatsapp === false) return false;
    if (path === "/estoque" && tenantFeatures.mod_estoque === false) return false;
    if (path === "/crm" && tenantFeatures.mod_crm === false) return false;
    if (path === "/equipe" && tenantFeatures.mod_equipe === false) return false;
    if (path === "/prontuario" && tenantFeatures.mod_odontograma === false) return false;
    if (path === "/atendimento" && tenantFeatures.mod_agenda === false) return false;
  }

  if (!allowedRoles) return true; // no restriction
  return allowedRoles.includes(role as AppRole);
}
