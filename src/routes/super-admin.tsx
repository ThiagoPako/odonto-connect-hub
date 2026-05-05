import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { saasApi, type Tenant, type Plan } from "@/lib/saasApi";
import { useAuth } from "@/hooks/useAuth";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldAlert, Loader2 } from "lucide-react";

export const Route = createFileRoute("/super-admin")({
  ssr: false,
  component: SuperAdminPage,
});

function SuperAdminPage() {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    const [t, p] = await Promise.all([saasApi.listTenants(), saasApi.listAllPlans()]);
    setTenants(t.data?.data ?? []);
    setPlans(p.data?.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (user?.is_super_admin) reload();
    else setLoading(false);
  }, [user?.is_super_admin]);

  if (!user?.is_super_admin) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold">Acesso restrito</h2>
          <p className="text-sm text-muted-foreground">Apenas super administradores podem ver esta página.</p>
        </div>
      </div>
    );
  }

  const setStatus = async (id: string, status: Tenant["status"]) => {
    const r = await saasApi.updateTenant(id, { status });
    if (r.error) return toast.error(r.error);
    toast.success("Atualizado");
    reload();
  };

  const setPlan = async (id: string, slug: string) => {
    const r = await saasApi.updateTenant(id, { plan_slug: slug });
    if (r.error) return toast.error(r.error);
    toast.success("Plano alterado");
    reload();
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Super Admin — SaaS" />
      <main className="flex-1 p-6 overflow-auto space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["trial", "active", "past_due", "suspended"] as const).map((s) => (
            <Card key={s}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">{s}</div>
                <div className="text-2xl font-bold text-foreground mt-1">
                  {tenants.filter((t) => t.status === s).length}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clínicas (tenants)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <div className="space-y-2">
                {tenants.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-3 justify-between p-3 rounded-lg border border-border">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{t.nome}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t.email_contato} · {t.users_count ?? 0} usuários · criado {new Date(t.created_at).toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={t.status === "active" ? "default" : "secondary"}>{t.status}</Badge>
                      <Select value={t.plan_slug ?? ""} onValueChange={(v) => setPlan(t.id, v)}>
                        <SelectTrigger className="w-36 h-8"><SelectValue placeholder="Plano" /></SelectTrigger>
                        <SelectContent>
                          {plans.map((p) => (
                            <SelectItem key={p.slug} value={p.slug}>{p.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={t.status} onValueChange={(v) => setStatus(t.id, v as Tenant["status"])}>
                        <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="trial">Trial</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="past_due">Past due</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                          <SelectItem value="canceled">Canceled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Planos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-3">
              {plans.map((p) => (
                <div key={p.id} className="p-4 rounded-lg border border-border">
                  <div className="font-semibold">{p.nome}</div>
                  <div className="text-xs text-muted-foreground mb-2">{p.slug}</div>
                  <div className="text-2xl font-bold">R$ {Number(p.preco_mensal).toFixed(0)}<span className="text-sm font-normal text-muted-foreground">/mês</span></div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {p.trial_days}d trial · {p.max_usuarios ?? "∞"} users · {p.max_dentistas ?? "∞"} dentistas
                  </div>
                  <Badge variant={p.ativo ? "default" : "secondary"} className="mt-2">
                    {p.ativo ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Edição completa de planos via API. UI de edição completa será adicionada em breve.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// Placeholder Button import to avoid unused warning if reordered
void Button;
