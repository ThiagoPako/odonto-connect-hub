import { useState, useEffect } from "react";
import { 
  History, 
  ArrowUpRight, 
  ArrowDownRight, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Clock,
  Search,
  Filter,
  CalendarDays,
  FileText,
  Landmark,
  Users,
  UserRound,
  Building2,
  Activity,
  RefreshCw
} from "lucide-react";
import { clinicorpApi, type ClinicorpAuditEntry } from "@/lib/clinicorpApi";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClinicorpMirrorAgenda } from "./ClinicorpMirrorAgenda";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";


export function ClinicorpAuditLog() {
  const [logs, setLogs] = useState<ClinicorpAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "clinicorp" | "odonto_connect">("all");
  const [searchTerm, setSearchTerm] = useState("");
  
  // Mirror states
  const [syncing, setSyncing] = useState(false);
  const [forceMetadata, setForceMetadata] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    loadLogs();
  }, []);

  useEffect(() => {
    clinicorpApi.getSettings().then(s => {
      if (s.last_sync_at) setLastSync(new Date(s.last_sync_at).toLocaleString("pt-BR"));
    }).catch(console.error);
    
    // Buscar um resumo rápido dos dados locais
    Promise.all([
      clinicorpApi.listPatients().then(d => d.length),
      clinicorpApi.listAppointments({ from: '2020-01-01', to: '2030-12-31' }).then(d => d.length),
      clinicorpApi.listEstimates().then(d => d.length)
    ]).then(([p, a, e]) => {
      setSummary({ patients: p, appointments: a, estimates: e });
    }).catch(console.error);
  }, [refreshTrigger]);

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await clinicorpApi.sync({ force_metadata: forceMetadata });
      setLastSync(new Date().toLocaleString("pt-BR"));
      setRefreshTrigger(prev => prev + 1);
      loadLogs();
      toast.success("Sincronização concluída com sucesso!");
    } catch (error) {
      toast.error("Falha ao sincronizar: " + (error as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  async function loadLogs() {
    try {
      setLoading(true);
      const data = await clinicorpApi.listAuditLogs(200);
      setLogs(data);
    } catch (err) {
      console.error("Failed to load audit logs", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = logs.filter(log => {
    const sourceMatch = filter === "all" || log.source === filter;
    const searchMatch = !searchTerm || 
      log.event.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.target_id && log.target_id.includes(searchTerm)) ||
      (log.error_message && log.error_message.toLowerCase().includes(searchTerm.toLowerCase()));
    return sourceMatch && searchMatch;
  });


  return (
    <div className="space-y-6">
      {/* Mirror Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card p-4 rounded-2xl border border-border shadow-sm">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            Sincronização
          </h2>
          <p className="text-xl font-bold mt-1">{lastSync ? 'Ativa' : 'Pendente'}</p>
          <p className="text-[10px] text-muted-foreground mt-1 truncate">
            {lastSync ? `Última: ${lastSync}` : 'Nunca sincronizado'}
          </p>
        </div>
        <div className="bg-card p-4 rounded-2xl border border-border shadow-sm">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <UserRound className="h-4 w-4" /> Pacientes
          </h2>
          <p className="text-xl font-bold mt-1">{summary?.patients ?? '...'}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Total importado</p>
        </div>
        <div className="bg-card p-4 rounded-2xl border border-border shadow-sm">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Agendamentos
          </h2>
          <p className="text-xl font-bold mt-1">{summary?.appointments ?? '...'}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Total no espelho</p>
        </div>
        <div className="bg-card p-4 rounded-2xl border border-border shadow-sm">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <FileText className="h-4 w-4" /> Orçamentos
          </h2>
          <p className="text-xl font-bold mt-1">{summary?.estimates ?? '...'}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Importados</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 bg-primary/5 p-4 rounded-2xl border border-primary/20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 p-2 rounded-full">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Controle de Sincronização</h3>
            <p className="text-xs text-muted-foreground">Gerencie a importação de dados da Clinicorp</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 p-2 rounded-lg transition-colors">
            <input 
              type="checkbox" 
              checked={forceMetadata} 
              onChange={(e) => setForceMetadata(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <span>Atualizar Cadastros (Lento)</span>
          </label>
          <Button onClick={handleManualSync} disabled={syncing} size="sm" className="gap-2 rounded-xl">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar Agora'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="auditoria" className="w-full">
        <TabsList className="flex flex-wrap h-auto p-1 bg-muted/50 mb-6 gap-1 w-fit">
          <TabsTrigger value="auditoria" className="gap-2">
            <History className="h-4 w-4" /> Auditoria
          </TabsTrigger>
          <TabsTrigger value="agenda" className="gap-2">
            <CalendarDays className="h-4 w-4" /> Agenda
          </TabsTrigger>
          <TabsTrigger value="orcamentos" className="gap-2">
            <FileText className="h-4 w-4" /> Orçamentos
          </TabsTrigger>
          <TabsTrigger value="financeiro" className="gap-2">
            <Landmark className="h-4 w-4" /> Financeiro
          </TabsTrigger>
          <TabsTrigger value="profissionais" className="gap-2">
            <Users className="h-4 w-4" /> Profissionais
          </TabsTrigger>
          <TabsTrigger value="pacientes" className="gap-2">
            <UserRound className="h-4 w-4" /> Pacientes
          </TabsTrigger>
          <TabsTrigger value="clinicas" className="gap-2">
            <Building2 className="h-4 w-4" /> Clínicas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auditoria" className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">Log de Auditoria e Espelhamento</h3>
            </div>
            
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Buscar por evento ou ID..." 
                  className="pl-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Fonte" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as Fontes</SelectItem>
                  <SelectItem value="clinicorp">Clinicorp (Entrada)</SelectItem>
                  <SelectItem value="odonto_connect">Odonto Connect (Saída)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="p-4 font-semibold">Data/Hora</th>
                    <th className="p-4 font-semibold">Fonte</th>
                    <th className="p-4 font-semibold">Evento</th>
                    <th className="p-4 font-semibold">ID Alvo</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={6} className="p-8 text-center bg-muted/10 h-12"></td>
                      </tr>
                    ))
                  ) : filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-muted-foreground">
                        Nenhum registro encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
                      <tr key={`${log.source}-${log.id}`} className="hover:bg-muted/30 transition-colors">
                        <td className="p-4 whitespace-nowrap text-muted-foreground">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">
                              {format(new Date(log.timestamp), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </span>
                            <span className="text-[10px] flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {format(new Date(log.timestamp), "HH:mm:ss")}
                            </span>
                          </div>
                        </td>
                        <td className="p-4">
                          {log.source === 'clinicorp' ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1 font-bold">
                              <ArrowDownRight className="h-3 w-3" /> Clinicorp
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1 font-bold">
                              <ArrowUpRight className="h-3 w-3" /> Odonto Connect
                            </Badge>
                          )}
                        </td>
                        <td className="p-4">
                          <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">
                            {log.event}
                          </code>
                        </td>
                        <td className="p-4 font-mono text-xs text-muted-foreground">
                          {log.target_id || "-"}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-1.5">
                            {log.status === 'processed' || log.status === 'success' ? (
                              <CheckCircle2 className="h-4 w-4 text-success" />
                            ) : log.status === 'error' ? (
                              <XCircle className="h-4 w-4 text-destructive" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-warning" />
                            )}
                            <span className="capitalize">{log.status}</span>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          {log.error_message && (
                            <button 
                              onClick={() => alert(log.error_message)}
                              className="text-xs text-destructive hover:underline"
                            >
                              Ver Erro
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="agenda" className="mt-0">
          <ClinicorpMirrorAgenda refreshTrigger={refreshTrigger} />
        </TabsContent>

        <TabsContent value="orcamentos">
          <EstimatesList />
        </TabsContent>

        <TabsContent value="financeiro">
          <FinancialList />
        </TabsContent>

        <TabsContent value="profissionais">
          <ProfessionalsList />
        </TabsContent>

        <TabsContent value="pacientes">
          <PatientsList />
        </TabsContent>

        <TabsContent value="clinicas">
          <ClinicsList />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EstimatesList() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clinicorpApi.listEstimates().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">Carregando orçamentos...</div>;

  return (
    <div className="space-y-3">
      {data.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground bg-card rounded-xl border">Nenhum orçamento encontrado.</div>
      ) : data.map((e) => (
        <div key={e.id} className="bg-card p-4 rounded-xl border border-border shadow-sm flex flex-wrap justify-between items-center gap-4">
          <div>
            <div className="font-bold text-lg">R$ {Number(e.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
            <div className="text-sm font-medium">{e.patient_name}</div>
            <div className="text-xs text-muted-foreground">{new Date(e.date).toLocaleDateString("pt-BR")} • {e.status}</div>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            <div>Profissional: {e.professional_name}</div>
            <div className="font-mono mt-1">ID Treatment: {e.treatment_id}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FinancialList() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clinicorpApi.listFinancial().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">Carregando financeiro...</div>;

  return (
    <div className="space-y-2">
      {data.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground bg-card rounded-xl border">Nenhuma entrada financeira encontrada.</div>
      ) : data.map((f) => (
        <div key={f.id} className="bg-card p-3 rounded-xl border border-border flex justify-between items-center gap-4">
          <div className="flex gap-4 items-center">
            <div className={cn(
              "w-2 h-10 rounded-full",
              f.source === 'payment' ? 'bg-green-500' : f.source === 'invoice' ? 'bg-blue-500' : 'bg-gray-400'
            )} />
            <div>
              <div className="font-bold text-base">R$ {Number(f.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
              <div className="text-xs font-medium uppercase text-muted-foreground">{f.source} • {new Date(f.date).toLocaleDateString("pt-BR")}</div>
            </div>
          </div>
          <div className="text-right flex-1 min-w-0">
            <div className="text-sm truncate">{f.description || 'Sem descrição'}</div>
            <div className="text-[10px] text-muted-foreground font-mono">EXT ID: {f.external_id}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfessionalsList() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clinicorpApi.listProfessionals().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">Carregando profissionais...</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {data.map((p) => (
        <div key={p.id} className="bg-card p-4 rounded-xl border border-border shadow-sm">
          <h3 className="font-bold">{p.full_name}</h3>
          <p className="text-sm text-muted-foreground">{p.user_name}</p>
          <div className="mt-2 text-[10px] text-muted-foreground uppercase">ID Clinicorp: {p.id}</div>
        </div>
      ))}
    </div>
  );
}

function PatientsList() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clinicorpApi.listPatients().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">Carregando pacientes...</div>;

  return (
    <div className="space-y-2">
      {data.map((p) => (
        <div key={p.id} className="bg-card p-3 rounded-xl border border-border flex justify-between items-center">
          <div>
            <h3 className="font-medium">{p.name}</h3>
            <p className="text-xs text-muted-foreground">{p.email} • {p.mobile_phone}</p>
          </div>
          <div className="text-[10px] text-muted-foreground font-mono">ID: {p.id}</div>
        </div>
      ))}
    </div>
  );
}

function ClinicsList() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clinicorpApi.listClinics().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">Carregando clínicas...</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {data.map((c) => (
        <div key={c.id} className="bg-card p-4 rounded-xl border border-border">
          <h3 className="font-bold">{c.name || c.business_name}</h3>
          <p className="text-sm text-muted-foreground">{c.address}</p>
          <div className="mt-2 flex gap-4 text-xs">
            <span>Slots: {c.slot_time}min</span>
            <span>{c.active ? 'Ativa' : 'Inativa'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

