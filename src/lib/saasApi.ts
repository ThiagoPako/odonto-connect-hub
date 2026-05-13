/**
 * SaaS API — Tenants, Plans, Subscriptions, Signup
 */
import { vpsApiFetch, setToken } from "./vpsApi";

export interface Plan {
  id: string;
  slug: string;
  nome: string;
  descricao: string | null;
  preco_mensal: number;
  preco_anual: number | null;
  trial_days: number;
  max_usuarios: number | null;
  max_dentistas: number | null;
  max_pacientes: number | null;
  max_whatsapp_instances: number | null;
  features: Record<string, unknown>;
  display_order: number;
  ativo?: boolean;
}

export interface Tenant {
  id: string;
  nome: string;
  slug: string;
  cnpj: string | null;
  telefone: string | null;
  email_contato: string | null;
  status: "trial" | "active" | "past_due" | "suspended" | "canceled";
  trial_ends_at: string | null;
  plan_id: string | null;
  current_period_end: string | null;
  plan_nome?: string;
  plan_slug?: string;
  preco_mensal?: number;
  features?: Record<string, unknown>;
  users_count?: number;
  created_at: string;
}

export interface Subscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: "active" | "canceled" | "past_due" | "expired";
  current_period_end: string | null;
  gateway: string | null;
}

export interface Invoice {
  id: string;
  amount: number;
  status: "pending" | "paid" | "failed" | "refunded" | "canceled";
  due_date: string | null;
  paid_at: string | null;
  payment_url: string | null;
  created_at: string;
}

export const saasApi = {
  listPlans: () => vpsApiFetch<{ data: Plan[] }>("/plans"),

  signupClinic: async (payload: {
    clinic_name: string;
    admin_name: string;
    email: string;
    password: string;
    plan_slug?: string;
    telefone?: string;
    cnpj?: string;
  }) => {
    const res = await vpsApiFetch<{ token: string; user: unknown; tenant: Tenant; plan: Plan }>(
      "/auth/signup-clinic",
      { method: "POST", body: payload }
    );
    if (res.data?.token) setToken(res.data.token);
    return res;
  },

  myTenant: () =>
    vpsApiFetch<{ tenant: Tenant; subscription: Subscription | null; invoices: Invoice[] }>(
      "/my-tenant"
    ),

  // Tenant user management
  listTenantUsers: () =>
    vpsApiFetch<{ data: Array<{ id: string; name: string; email: string; role: string; active: boolean; avatar_url: string | null; created_at: string }> }>(
      "/my-tenant/users"
    ),
  createTenantUser: (body: { name: string; email: string; password: string; role: string }) =>
    vpsApiFetch<{ success: boolean; user: { id: string; name: string; email: string; role: string; active: boolean } }>(
      "/my-tenant/users",
      { method: "POST", body }
    ),
  updateTenantUser: (id: string, body: { name?: string; email?: string; role?: string; active?: boolean }) =>
    vpsApiFetch<{ success: boolean }>(`/my-tenant/users/${id}`, { method: "PATCH", body }),
  resetTenantUserPassword: (id: string, password: string) =>
    vpsApiFetch<{ success: boolean }>(`/my-tenant/users/${id}/reset-password`, {
      method: "POST",
      body: { password },
    }),

  changePlan: (plan_slug: string) =>
    vpsApiFetch<{ ok: boolean; plan: Plan }>("/my-tenant/change-plan", {
      method: "POST",
      body: { plan_slug },
    }),

  // Super admin
  listTenants: () => vpsApiFetch<{ data: Tenant[] }>("/super-admin/tenants"),
  updateTenant: (id: string, body: Partial<Pick<Tenant, "status">> & { plan_slug?: string; trial_ends_at?: string; current_period_end?: string }) =>
    vpsApiFetch<{ data: Tenant }>(`/super-admin/tenants/${id}`, { method: "PATCH", body }),

  listAllPlans: () => vpsApiFetch<{ data: Plan[] }>("/super-admin/plans"),
  createPlan: (body: Partial<Plan>) =>
    vpsApiFetch<{ data: Plan }>("/super-admin/plans", { method: "POST", body }),
  updatePlan: (id: string, body: Partial<Plan>) =>
    vpsApiFetch<{ data: Plan }>(`/super-admin/plans/${id}`, { method: "PATCH", body }),

  getStats: () =>
    vpsApiFetch<{ data: { 
      mrr: number; 
      arr: number; 
      receita_mes: number; 
      receita_mes_anterior: number; 
      total_pendente: number; 
      total_pix: number; 
      receita_recorrente: number; 
    } }>("/super-admin/stats"),
};
