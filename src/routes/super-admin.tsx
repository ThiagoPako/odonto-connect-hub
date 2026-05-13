import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { saasApi, type Tenant, type Plan } from "@/lib/saasApi";
import { useAuth } from "@/hooks/useAuth";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ShieldAlert, Loader2, Users, Building2, CreditCard, Search, ExternalLink, Calendar, Plus, Save } from "lucide-react";

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

  const reload = async () => {
    setLoading(true);
    try {
      const [t, p] = await Promise.all([saasApi.listTenants(), saasApi.listAllPlans()]);
      setTenants(t.data?.data ?? []);
      setPlans(p.data?.data ?? []);
    } catch (err) {
      toast.error("Erro ao carregar dados do sistema");
    } finally {
      setLoading(false);
    }
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

  const filteredTenants = tenants.filter(t => 
    t.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.email_contato?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-muted/30">
      <DashboardHeader title="Painel do Super Administrador" />
      
      <main className="flex-1 p-6 overflow-auto space-y-6 max-w-7xl mx-auto w-full">
        {/* Resumo de Métricas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-none shadow-sm bg-gradient-to-br from-primary/5 to-primary/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                  <Building2 size={20} />
                </div>
                <Badge variant="outline" className="bg-background/50">{tenants.length} Total</Badge>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Ativos</h3>
                <p className="text-3xl font-bold text-foreground">
                  {tenants.filter(t => t.status === "active").length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-gradient-to-br from-amber-500/5 to-amber-500/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-600">
                  <Calendar size={20} />
                </div>
                <Badge variant="outline" className="bg-background/50">Trials</Badge>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Em Teste</h3>
                <p className="text-3xl font-bold text-foreground">
                  {tenants.filter(t => t.status === "trial").length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-gradient-to-br from-destructive/5 to-destructive/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-full bg-destructive/20 flex items-center justify-center text-destructive">
                  <ShieldAlert size={20} />
                </div>
                <Badge variant="outline" className="bg-background/50">Atenção</Badge>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Inadimplentes</h3>
                <p className="text-3xl font-bold text-foreground">
                  {tenants.filter(t => t.status === "past_due").length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-gradient-to-br from-blue-500/5 to-blue-500/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-600">
                  <Users size={20} />
                </div>
                <Badge variant="outline" className="bg-background/50">Usuários</Badge>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total de Contas</h3>
                <p className="text-3xl font-bold text-foreground">
                  {tenants.reduce((acc, curr) => acc + (curr.users_count || 0), 0)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <TabsList className="bg-background border h-10 p-1">
              <TabsTrigger value="clinicas" className="px-6 data-[state=active]:bg-muted">Clínicas</TabsTrigger>
              <TabsTrigger value="planos" className="px-6 data-[state=active]:bg-muted">Planos & Assinaturas</TabsTrigger>
              <TabsTrigger value="configuracoes" className="px-6 data-[state=active]:bg-muted">Configurações SaaS</TabsTrigger>
            </TabsList>
            
            {activeTab === "clinicas" && (
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Buscar clínica, e-mail ou slug..." 
                  className="pl-9 bg-background"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            )}
          </div>

          <TabsContent value="clinicas" className="mt-0 border-none p-0 focus-visible:ring-0">
            <Card className="border shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/20 py-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Building2 size={18} className="text-primary" />
                  Gerenciamento de Tenants
                </CardTitle>
                <Badge variant="secondary" className="font-normal">{filteredTenants.length} registros encontrados</Badge>
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
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-bold text-foreground text-lg group-hover:text-primary transition-colors">{t.nome}</h4>
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
                <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/20 py-4">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <CreditCard size={18} className="text-primary" />
                    Catálogo de Planos
                  </CardTitle>
                  <Button size="sm" className="h-8 gap-2">
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
                          <Button variant="outline" size="sm" className="flex-1">Configurar Recursos</Button>
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0"><Save size={14} /></Button>
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
                
                <div className="flex items-center justify-between p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-amber-600">Manutenção de Banco de Dados</p>
                    <p className="text-xs text-muted-foreground">Otimiza tabelas e limpa logs antigos.</p>
                  </div>
                  <Button variant="outline" size="sm" className="bg-background">Executar Agora</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}


