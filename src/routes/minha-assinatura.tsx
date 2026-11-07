import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { saasApi, type Tenant, type Subscription, type Invoice, type Plan } from "@/lib/saasApi";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AlertTriangle, CreditCard, Crown, Loader2, RefreshCw } from "lucide-react";

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

const INVOICE_STATUS_LABEL: Record<string, string> = {
  paid: "Paga",
  pending: "Em aberto",
  failed: "Falhou",
  refunded: "Reembolsada",
  canceled: "Cancelada",
};

// Mesmo formato em todo lugar: antes o card arredondava (R$ 150) e o diálogo mostrava R$ 149.90.
const brl = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const limite = (v: number | null, singular: string, plural: string) =>
  v == null ? `${plural} ilimitados` : `até ${v} ${v === 1 ? singular : plural}`;

function MinhaAssinaturaPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [changing, setChanging] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<Plan | null>(null);

  const reload = async () => {
    setLoadError(null);
    const [t, p] = await Promise.all([saasApi.myTenant(), saasApi.listPlans()]);
    if (t.data) {
      setTenant(t.data.tenant);
      setSub(t.data.subscription);
      setInvoices(t.data.invoices);
    } else {
      setLoadError(t.error || "Resposta vazia do servidor");
    }
    if (p.data) {
      setPlans(p.data.data);
      setPlansError(null);
    } else {
      setPlansError(p.error || "Resposta vazia do servidor");
    }
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

  if (!tenant && loadError) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Minha Assinatura" />
        <main className="flex-1 p-6 flex items-start justify-center">
          <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
            <AlertTriangle className="h-6 w-6 text-destructive mx-auto" />
            <p className="text-sm font-medium text-foreground">Não foi possível carregar sua assinatura</p>
            <p className="text-xs text-muted-foreground">{loadError}</p>
            <Button variant="outline" onClick={() => reload()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Tentar de novo
            </Button>
          </div>
        </main>
      </div>
    );
  }

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
      <main className="flex-1 p-4 sm:p-6 overflow-auto space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-primary" /> {tenant.nome}
                </CardTitle>
                <CardDescription>
                  Plano atual: <strong>{tenant.plan_nome ?? "Nenhum"}</strong>
                  {tenant.preco_mensal ? ` — ${brl(tenant.preco_mensal)}/mês` : ""}
                </CardDescription>
              </div>
              <Badge variant={(STATUS_LABEL[tenant.status] ?? { variant: "secondary" }).variant}>
                {STATUS_LABEL[tenant.status]?.label ?? tenant.status}
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
          {plansError && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <span className="text-destructive">Não foi possível carregar os planos: {plansError}</span>
              <Button size="sm" variant="outline" onClick={() => reload()}>
                <RefreshCw className="h-4 w-4 mr-2" /> Tentar de novo
              </Button>
            </div>
          )}
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
                      {brl(p.preco_mensal)}
                      <span className="text-sm font-normal text-muted-foreground"> /mês</span>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>• {limite(p.max_usuarios, "usuário", "usuários")}</li>
                      <li>• {limite(p.max_dentistas, "dentista", "dentistas")}</li>
                      <li>• {limite(p.max_pacientes, "paciente", "pacientes")}</li>
                    </ul>
                    <Button
                      disabled={isCurrent || changing === p.slug}
                      onClick={() => setConfirmPlan(p)}
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
                      <div className="text-sm font-medium">{brl(inv.amount)}</div>
                      <div className="text-xs text-muted-foreground">
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString("pt-BR") : "—"}
                      </div>
                    </div>
                    <Badge variant={inv.status === "paid" ? "default" : "secondary"}>
                      {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!confirmPlan} onOpenChange={(o) => { if (!o) setConfirmPlan(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar para o plano {confirmPlan?.nome}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {confirmPlan && (
                  <>
                    <p>
                      Valor: <strong className="text-foreground">{brl(confirmPlan.preco_mensal)}/mês</strong>
                      {tenant.plan_nome ? <> (hoje: {tenant.plan_nome}{tenant.preco_mensal ? ` — ${brl(tenant.preco_mensal)}/mês` : ""})</> : null}
                    </p>
                    <p>
                      Limites: {limite(confirmPlan.max_dentistas, "dentista", "dentistas")}, {limite(confirmPlan.max_usuarios, "usuário", "usuários")} e {limite(confirmPlan.max_pacientes, "paciente", "pacientes")}.
                    </p>
                  </>
                )}
                <p>A troca vale imediatamente. Confira se sua equipe e seus pacientes cabem nos limites do novo plano.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const slug = confirmPlan?.slug;
                setConfirmPlan(null);
                if (slug) changePlan(slug);
              }}
            >
              Trocar plano
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
