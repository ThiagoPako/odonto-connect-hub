import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { saasApi, type Tenant, type Subscription, type Invoice, type Plan } from "@/lib/saasApi";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CreditCard, Crown, Loader2 } from "lucide-react";

export const Route = createFileRoute("/minha-assinatura")({
  ssr: false,
  component: MinhaAssinaturaPage,
});

const STATUS_LABEL: Record<Tenant["status"], { label: string; variant: "default" | "secondary" | "destructive" }> = {
  trial: { label: "Em teste", variant: "secondary" },
  active: { label: "Ativa", variant: "default" },
  past_due: { label: "Atrasada", variant: "destructive" },
  suspended: { label: "Suspensa", variant: "destructive" },
  canceled: { label: "Cancelada", variant: "destructive" },
};

function MinhaAssinaturaPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [changing, setChanging] = useState<string | null>(null);

  const reload = async () => {
    const [t, p] = await Promise.all([saasApi.myTenant(), saasApi.listPlans()]);
    if (t.data) {
      setTenant(t.data.tenant);
      setSub(t.data.subscription);
      setInvoices(t.data.invoices);
    }
    if (p.data) setPlans(p.data.data);
  };

  useEffect(() => { reload(); }, []);

  const changePlan = async (slug: string) => {
    setChanging(slug);
    const r = await saasApi.changePlan(slug);
    setChanging(null);
    if (r.error) return toast.error(r.error);
    toast.success("Plano atualizado");
    reload();
  };

  if (!tenant) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const trialDaysLeft = tenant.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000))
    : 0;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Minha Assinatura" />
      <main className="flex-1 p-6 overflow-auto space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-primary" /> {tenant.nome}
                </CardTitle>
                <CardDescription>
                  Plano atual: <strong>{tenant.plan_nome ?? "Nenhum"}</strong>
                  {tenant.preco_mensal ? ` — R$ ${Number(tenant.preco_mensal).toFixed(2)}/mês` : ""}
                </CardDescription>
              </div>
              <Badge variant={STATUS_LABEL[tenant.status].variant}>
                {STATUS_LABEL[tenant.status].label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {tenant.status === "trial" ? (
              <p>
                Seu teste termina em <strong>{trialDaysLeft} dia{trialDaysLeft !== 1 ? "s" : ""}</strong>.
                Escolha um plano abaixo para continuar usando após o trial.
              </p>
            ) : sub?.current_period_end ? (
              <p>Próxima renovação: {new Date(sub.current_period_end).toLocaleDateString("pt-BR")}</p>
            ) : null}
          </CardContent>
        </Card>

        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Planos disponíveis</h3>
          <div className="grid md:grid-cols-3 gap-4">
            {plans.map((p) => {
              const isCurrent = p.slug === tenant.plan_slug;
              return (
                <Card key={p.id} className={isCurrent ? "border-primary ring-2 ring-primary/30" : ""}>
                  <CardHeader>
                    <CardTitle className="text-base">{p.nome}</CardTitle>
                    <CardDescription>{p.descricao}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-2xl font-bold text-foreground">
                      R$ {Number(p.preco_mensal).toFixed(0)}
                      <span className="text-sm font-normal text-muted-foreground"> /mês</span>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>• {p.max_usuarios ?? "Ilimitados"} usuários</li>
                      <li>• {p.max_dentistas ?? "Ilimitados"} dentistas</li>
                      <li>• {p.max_pacientes ?? "Ilimitados"} pacientes</li>
                    </ul>
                    <Button
                      disabled={isCurrent || changing === p.slug}
                      onClick={() => changePlan(p.slug)}
                      className="w-full"
                      variant={isCurrent ? "secondary" : "default"}
                    >
                      {changing === p.slug ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      {isCurrent ? "Plano atual" : "Selecionar"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4 text-primary" /> Histórico de cobranças
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma fatura ainda.</p>
            ) : (
              <div className="space-y-2">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                    <div>
                      <div className="text-sm font-medium">R$ {Number(inv.amount).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString("pt-BR") : "—"}
                      </div>
                    </div>
                    <Badge variant={inv.status === "paid" ? "default" : "secondary"}>
                      {inv.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
