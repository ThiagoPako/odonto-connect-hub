import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { saasApi, type Tenant, type Plan } from "@/lib/saasApi";
import { useAuth } from "@/hooks/useAuth";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ShieldAlert, Loader2, Users, Building2, CreditCard, Search, ExternalLink, Calendar, Plus, Save, TrendingUp, DollarSign, UserMinus, Edit, Crown, RefreshCw } from "lucide-react";
import { PlanEditorDialog } from "@/components/PlanEditorDialog";
import { BarraFiltros } from "@/components/filtros/BarraFiltros";
import { useFiltroUrl } from "@/components/filtros/useFiltroUrl";
import SaasKpiCards from "@/components/admin-saas/SaasKpiCards";
import BuscadorLeads from "@/components/comercial/BuscadorLeads";

export const Route = createFileRoute("/super-admin")({
  ssr: false,
  component: SuperAdminPage,
});

function SuperAdminPage() {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("clinicas");
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [isPlanDialogOpen, setIsPlanDialogOpen] = useState(false);
  const [planoUrl, setPlanoFiltro] = useFiltroUrl("plano");
  const [statusFiltro, setStatusFiltro] = useFiltroUrl("status", ["trial", "active", "past_due", "suspended", "canceled"]);
  const [stats, setStats] = useState({
    mrr: 0,
    arr: 0,
    receita_mes: 0,
    receita_mes_anterior: 0,
    total_pendente: 0,
    total_pix: 0,
    receita_recorrente: 0
  });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [t, p, s] = await Promise.all([
        saasApi.listTenants(), 
        saasApi.listAllPlans(),
        saasApi.getStats()
      ]);
      // vpsApiFetch não lança: o erro vem em .error e precisa aparecer para quem opera o painel
      const erros = [t.error && "clínicas", p.error && "planos", s.error && "métricas"].filter(Boolean);
      if (erros.length) toast.error(`Não foi possível carregar: ${erros.join(", ")}. Tente "Atualizar dados".`);
      setTenants(t.data?.data ?? []);
      setPlans(p.data?.data ?? []);
      if (s.data?.data) {
        setStats(s.data.data);
      }
    } catch (err) {
      toast.error("Erro ao carregar dados do sistema");
    } finally {
      setLoading(false);
    }
  }, []);

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

  // Valor da URL que não existe nas opções atuais (link antigo, item apagado) é ignorado: nada de filtro invisível.
  const planoFiltro = plans.some(p => p.id === planoUrl) ? planoUrl : "";
  const termo = searchTerm.trim().toLowerCase();
  const filteredTenants = tenants.filter(t =>
    (!planoFiltro || t.plan_id === planoFiltro) &&
    (!statusFiltro || t.status === statusFiltro) &&
    (!termo ||
      (t.nome || "").toLowerCase().includes(termo) ||
      (t.email_contato || "").toLowerCase().includes(termo) ||
      (t.slug || "").toLowerCase().includes(termo))
  );

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-muted/30">
      <DashboardHeader title="Painel do Super Administrador" icon={Crown} />
      
      <div className="flex-1 p-4 sm:p-6 overflow-auto space-y-6 max-w-7xl mx-auto w-full">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={reload} disabled={loading} className="h-9 px-4 gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar dados
          </Button>
        </div>

        {/* Resumo de Métricas CareFlow Style */}
        <SaasKpiCards 
          mrr={stats.mrr}
          arr={stats.arr}
          receitaMes={stats.receita_mes}
          receitaMesAnterior={stats.receita_mes_anterior}
          totalPix={stats.total_pix}
          totalPendente={stats.total_pendente}
          receitaRecorrente={stats.receita_recorrente}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="mb-4 overflow-x-auto">
            <TabsList className="bg-background border h-auto min-h-10 p-1 flex-wrap justify-start">
              <TabsTrigger value="clinicas" className="px-6 data-[state=active]:bg-muted">Clínicas</TabsTrigger>
              <TabsTrigger value="planos" className="px-6 data-[state=active]:bg-muted">Planos & Assinaturas</TabsTrigger>
              <TabsTrigger value="leads" className="px-6 data-[state=active]:bg-muted">Leads (comercial)</TabsTrigger>
              <TabsTrigger value="configuracoes" className="px-6 data-[state=active]:bg-muted">Configurações SaaS</TabsTrigger>
            </TabsList>
            
          </div>
          {activeTab === "clinicas" && (
            <BarraFiltros
              className="mb-4"
              busca={{ valor: searchTerm, onChange: setSearchTerm, placeholder: "Clínica, e-mail ou slug", rotulo: "Buscar clínica por nome, e-mail ou slug" }}
              filtros={[
                { id: "plano", rotulo: "Plano", valor: planoFiltro, onChange: setPlanoFiltro, rotuloTodos: "Todos os planos", opcoes: plans.map(p => ({ valor: p.id, rotulo: p.nome })) },
                { id: "status", rotulo: "Status da assinatura", valor: statusFiltro, onChange: setStatusFiltro, opcoes: [
                  { valor: "active", rotulo: "Ativa" },
                  { valor: "trial", rotulo: "Em teste" },
                  { valor: "past_due", rotulo: "Pagamento atrasado" },
                  { valor: "suspended", rotulo: "Suspensa" },
                  { valor: "canceled", rotulo: "Cancelada" },
                ] },
              ]}
              onLimpar={() => { setSearchTerm(""); setPlanoFiltro(""); setStatusFiltro(""); }}
              resultado={`${filteredTenants.length} clínica${filteredTenants.length !== 1 ? "s" : ""}`}
            />
          )}

          <TabsContent value="clinicas" className="mt-0 border-none p-0 focus-visible:ring-0">
            <Card className="border shadow-sm">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b bg-muted/20 py-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Building2 size={18} className="text-primary" />
                  Gerenciamento de Tenants
                </CardTitle>
                <Badge variant="secondary" className="font-normal whitespace-nowrap">{filteredTenants.length} encontrada{filteredTenants.length !== 1 ? "s" : ""}</Badge>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-12 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p>Sincronizando dados em tempo real...</p>
                  </div>
                ) : (
                  <div className="divide-y overflow-hidden rounded-b-lg">
                    {filteredTenants.length === 0 ? (
                      <div className="p-12 text-center text-muted-foreground">Nenhuma clínica encontrada para esta busca.</div>
                    ) : (
                      filteredTenants.map((t) => (
                        <div key={t.id} className="group flex flex-col md:flex-row md:items-center gap-4 p-5 hover:bg-muted/30 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h4 className="font-bold text-foreground text-lg group-hover:text-primary transition-colors break-words min-w-0">{t.nome}</h4>
                              <Badge variant={t.status === "active" ? "default" : t.status === "trial" ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px] uppercase">
                                {t.status}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1"><Users size={14} /> {t.users_count ?? 0} usuários</span>
                              <span className="flex items-center gap-1 lowercase"><Search size={14} /> /{t.slug}</span>
                              <span className="flex items-center gap-1 font-mono text-xs opacity-70">{t.id.slice(0, 8)}...</span>
                            </div>
                            <div className="mt-2 text-sm font-medium flex items-center gap-1">
                              <span className="text-muted-foreground font-normal">Contato:</span> {t.email_contato}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            <div className="space-y-1.5 min-w-[140px]">
                              <label className="text-[10px] uppercase font-bold text-muted-foreground px-1">Plano Atual</label>
                              <Select value={t.plan_slug ?? ""} onValueChange={(v) => setPlan(t.id, v)}>
                                <SelectTrigger className="h-9 bg-background border-muted-foreground/20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {plans.map((p) => (
                                    <SelectItem key={p.slug} value={p.slug}>
                                      <div className="flex items-center gap-2">
                                        <div className={`h-2 w-2 rounded-full ${p.ativo ? 'bg-green-500' : 'bg-gray-400'}`} />
                                        {p.nome}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1.5 min-w-[130px]">
                              <label className="text-[10px] uppercase font-bold text-muted-foreground px-1">Alterar Status</label>
                              <Select value={t.status} onValueChange={(v) => setStatus(t.id, v as Tenant["status"])}>
                                <SelectTrigger className="h-9 bg-background border-muted-foreground/20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="trial">Trial (Teste)</SelectItem>
                                  <SelectItem value="active">Ativo (Pago)</SelectItem>
                                  <SelectItem value="past_due">Atrasado</SelectItem>
                                  <SelectItem value="suspended">Suspenso</SelectItem>
                                  <SelectItem value="canceled">Cancelado</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" title="Ver detalhes da conta">
                              <ExternalLink size={18} />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="planos" className="mt-0 border-none p-0 focus-visible:ring-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 border shadow-sm">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b bg-muted/20 py-4">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <CreditCard size={18} className="text-primary" />
                    Catálogo de Planos
                  </CardTitle>
                  <Button size="sm" className="h-8 gap-2" onClick={() => { setSelectedPlan(null); setIsPlanDialogOpen(true); }}>
                    <Plus size={16} /> Novo Plano
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="grid md:grid-cols-2 gap-px bg-border">
                    {plans.map((p) => (
                      <div key={p.id} className="p-6 bg-background space-y-4 hover:bg-muted/10 transition-colors">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-bold text-lg">{p.nome}</h4>
                            <p className="text-xs text-muted-foreground font-mono">slug: {p.slug}</p>
                          </div>
                          <Badge variant={p.ativo ? "default" : "secondary"}>
                            {p.ativo ? "Ativo" : "Inativo"}
                          </Badge>
                        </div>
                        
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-black">R$ {Number(p.preco_mensal).toLocaleString('pt-BR')}</span>
                          <span className="text-sm text-muted-foreground font-medium">/mês</span>
                        </div>

                        <div className="grid grid-cols-2 gap-y-2 text-sm border-t pt-4">
                          <div className="flex flex-col">
                            <span className="text-muted-foreground text-[10px] uppercase font-bold">Teste Grátis</span>
                            <span>{p.trial_days} dias</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-muted-foreground text-[10px] uppercase font-bold">Usuários</span>
                            <span>{p.max_usuarios ?? "Ilimitado"}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-muted-foreground text-[10px] uppercase font-bold">Dentistas</span>
                            <span>{p.max_dentistas ?? "Ilimitado"}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-muted-foreground text-[10px] uppercase font-bold">Pacientes</span>
                            <span>{p.max_pacientes ?? "Ilimitado"}</span>
                          </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => { setSelectedPlan(p); setIsPlanDialogOpen(true); }}>
                            <Edit className="h-4 w-4 mr-1.5" /> Editar Plano
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border shadow-sm h-fit">
                <CardHeader className="border-b bg-muted/20 py-4">
                  <CardTitle className="text-base font-semibold">Resumo de Assinaturas</CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  <div className="space-y-4">
                    {plans.map(p => {
                      const count = tenants.filter(t => t.plan_id === p.id).length;
                      const percentage = tenants.length > 0 ? (count / tenants.length) * 100 : 0;
                      return (
                        <div key={p.id} className="space-y-1.5">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium">{p.nome}</span>
                            <span className="text-muted-foreground">{count} ({percentage.toFixed(0)}%)</span>
                          </div>
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${percentage}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-6 border-t space-y-4">
                    <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Receita Mensal Estimada (MRR)</p>
                      <p className="text-2xl font-black text-primary">
                        R$ {tenants
                          .filter(t => t.status === "active")
                          .reduce((acc, t) => acc + (plans.find(p => p.id === t.plan_id)?.preco_mensal || 0), 0)
                          .toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="leads" className="mt-0 border-none p-0 focus-visible:ring-0">
            {activeTab === "leads" && <BuscadorLeads />}
          </TabsContent>

          <TabsContent value="configuracoes" className="mt-0 border-none p-0 focus-visible:ring-0">
             <Card className="border shadow-sm max-w-2xl">
              <CardHeader className="border-b bg-muted/20 py-4">
                <CardTitle className="text-base font-semibold">Configurações Globais do SaaS</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Gateway de Pagamento Ativo</label>
                  <Select defaultValue="manual">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Controle Manual / Offline</SelectItem>
                      <SelectItem value="asaas" disabled>Asaas (Em Breve)</SelectItem>
                      <SelectItem value="stripe" disabled>Stripe (Em Breve)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center justify-between p-4 rounded-lg border border-red-500/20 bg-red-500/5">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-red-600 italic">Área de Risco: Reset de Sistema</p>
                    <p className="text-xs text-muted-foreground">Limpa dados globais de manutenção (use com cuidado).</p>
                  </div>
                  <Button variant="destructive" size="sm">Limpar Cache Global</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <PlanEditorDialog 
          open={isPlanDialogOpen} 
          onOpenChange={setIsPlanDialogOpen} 
          plan={selectedPlan} 
          onSuccess={reload} 
        />
      </div>
    </div>
  );
}


