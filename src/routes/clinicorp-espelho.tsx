import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, Users, UserRound, Building2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { clinicorpApi } from "@/lib/clinicorpApi";
import { ClinicorpMirrorAgenda } from "@/components/clinicorp/ClinicorpMirrorAgenda";

export const Route = createFileRoute("/clinicorp-espelho")({
  component: ClinicorpEspelhoPage,
});

function ClinicorpEspelhoPage() {
  const [syncing, setSyncing] = useState(false);
  const [forceMetadata, setForceMetadata] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    clinicorpApi.getSettings().then(s => {
      if (s.last_sync_at) setLastSync(new Date(s.last_sync_at).toLocaleString("pt-BR"));
    }).catch(console.error);
  }, []);

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await clinicorpApi.sync({ force_metadata: forceMetadata });
      setLastSync(new Date().toLocaleString("pt-BR"));
      setRefreshTrigger(prev => prev + 1);
      toast.success("Sincronização concluída com sucesso!");
    } catch (error) {
      toast.error("Falha ao sincronizar: " + (error as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-background/50">
      <DashboardHeader title="Espelho Clinicorp" />
      
      <main className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-4 bg-card p-4 rounded-2xl border border-border shadow-sm">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <RefreshCw className={`h-5 w-5 text-primary ${syncing ? 'animate-spin' : ''}`} />
              Status da Integração
            </h2>
            <p className="text-sm text-muted-foreground">
              {lastSync ? `Última sincronização: ${lastSync}` : 'Sincronização nunca realizada'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-2 rounded-lg transition-colors">
              <input 
                type="checkbox" 
                checked={forceMetadata} 
                onChange={(e) => setForceMetadata(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <span>Forçar atualização de cadastros</span>
            </label>
            <Button onClick={handleManualSync} disabled={syncing} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              Sincronizar Agora
            </Button>
          </div>
        </div>

        <Tabs defaultValue="agenda" className="w-full">
          <TabsList className="grid w-full grid-cols-4 lg:w-[600px] mb-6">
            <TabsTrigger value="agenda" className="gap-2">
              <CalendarDays className="h-4 w-4" /> Agenda
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

          <TabsContent value="agenda" className="mt-0">
            <ClinicorpMirrorAgenda refreshTrigger={refreshTrigger} />
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
      </main>
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
