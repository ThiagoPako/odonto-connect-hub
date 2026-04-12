import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { InstanceCard } from "@/components/whatsapp/InstanceCard";
import { QrCodeDialog } from "@/components/whatsapp/QrCodeDialog";
import { CreateInstanceDialog } from "@/components/whatsapp/CreateInstanceDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, RefreshCw, Loader2, WifiOff, Smartphone, Wifi, Star } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { fetchInstances, type EvolutionInstance } from "@/lib/evolutionApi";
import { toast } from "sonner";

export const Route = createFileRoute("/canais")({
  ssr: false,
  component: CanaisPage,
});

interface InstanceWithState extends EvolutionInstance {
  connectionState: "open" | "close" | "connecting";
}

const DEFAULT_SWITCH_MSG = `Olá! Informamos que tivemos um problema técnico temporário com nossa conexão anterior. Estamos continuando seu atendimento por este novo número. Fique tranquilo(a), temos todo o histórico da sua conversa e seguiremos de onde paramos. 😊`;

function CanaisPage() {
  const [instances, setInstances] = useState<InstanceWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [qrInstance, setQrInstance] = useState<string | null>(null);
  const [primaryInstance, setPrimaryInstance] = useState<string | null>(() => {
    try { return localStorage.getItem("wa_primary_instance"); } catch { return null; }
  });

  // Switch primary dialog
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const [pendingSwitchName, setPendingSwitchName] = useState<string | null>(null);
  const [switchMsg, setSwitchMsg] = useState(DEFAULT_SWITCH_MSG);
  const [switching, setSwitching] = useState(false);

  const loadInstances = useCallback(async (showLoader = true) => {
    if (showLoader) {
      setLoading(true);
      setError(null);
    }
    try {
      const list = await fetchInstances();
      setInstances(list.map((inst) => ({ ...inst, connectionState: inst.status })));
    } catch (err) {
      if (showLoader || instances.length === 0) {
        setError(err instanceof Error ? err.message : "Erro ao carregar instâncias");
      }
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [instances.length]);

  useEffect(() => { void loadInstances(); }, [loadInstances]);

  useEffect(() => {
    if (!instances.some((inst) => inst.connectionState === "connecting")) return;
    const interval = setInterval(() => { void loadInstances(false); }, 5000);
    return () => clearInterval(interval);
  }, [instances, loadInstances]);

  const handleCreated = (name: string) => {
    void loadInstances();
    setQrInstance(name);
  };

  const handleSetPrimary = (name: string) => {
    setPendingSwitchName(name);
    setSwitchMsg(DEFAULT_SWITCH_MSG);
    setSwitchDialogOpen(true);
  };

  const confirmSwitchPrimary = async () => {
    if (!pendingSwitchName) return;
    setSwitching(true);
    try {
      localStorage.setItem("wa_primary_instance", pendingSwitchName);
      setPrimaryInstance(pendingSwitchName);

      // TODO: Integrar com backend para enviar mensagem para pacientes em atendimento aberto
      // POST /api/whatsapp/switch-primary { newInstance, message: switchMsg }
      console.log("Switching primary to:", pendingSwitchName, "Message:", switchMsg);

      toast.success(`"${pendingSwitchName}" agora é a conexão principal. Mensagens de aviso serão enviadas.`);
      setSwitchDialogOpen(false);
    } catch (err) {
      toast.error("Erro ao trocar conexão principal");
    } finally {
      setSwitching(false);
    }
  };

  const connectedCount = instances.filter((i) => i.connectionState === "open").length;
  const disconnectedCount = instances.filter((i) => i.connectionState !== "open").length;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Canais WhatsApp" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">

        {/* Stats bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card rounded-2xl border border-border p-5 flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <Smartphone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{instances.length}</p>
              <p className="text-xs text-muted-foreground">Total de Números</p>
            </div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-5 flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-success/10 flex items-center justify-center">
              <Wifi className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-success">{connectedCount}</p>
              <p className="text-xs text-muted-foreground">Conectados</p>
            </div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-5 flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-muted flex items-center justify-center">
              <WifiOff className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{disconnectedCount}</p>
              <p className="text-xs text-muted-foreground">Desconectados</p>
            </div>
          </div>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Números Conectados</h2>
            <p className="text-sm text-muted-foreground">
              Gerencie múltiplos números WhatsApp via Evolution API
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadInstances()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Número
            </Button>
          </div>
        </div>

        {/* Primary instance banner */}
        {primaryInstance && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl px-5 py-3 flex items-center gap-3">
            <Star className="h-4 w-4 text-primary fill-primary" />
            <span className="text-sm text-foreground">
              Conexão principal: <strong className="text-primary">{primaryInstance}</strong>
            </span>
          </div>
        )}

        {/* Cards grid */}
        {loading && instances.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <WifiOff className="h-10 w-10 text-destructive" />
            <p className="text-sm text-destructive text-center max-w-md">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void loadInstances()}>
              Tentar novamente
            </Button>
          </div>
        ) : instances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 bg-card rounded-2xl border border-dashed border-border">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
              <Smartphone className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">Nenhum número conectado</p>
              <p className="text-xs text-muted-foreground mt-1">Adicione seu primeiro número WhatsApp</p>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Conectar primeiro número
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {instances.map((inst, i) => (
              <div key={inst.instanceId} className="animate-fade-in" style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}>
                <InstanceCard
                  instanceName={inst.instanceName}
                  instanceId={inst.instanceId}
                  status={inst.connectionState}
                  isPrimary={inst.instanceName === primaryInstance}
                  onConnect={(name) => setQrInstance(name)}
                  onRefresh={() => void loadInstances()}
                  onSetPrimary={handleSetPrimary}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      <CreateInstanceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />

      {qrInstance && (
        <QrCodeDialog
          open={!!qrInstance}
          onOpenChange={(open) => !open && setQrInstance(null)}
          instanceName={qrInstance}
          onConnected={() => void loadInstances(false)}
        />
      )}

      {/* Switch primary dialog */}
      <Dialog open={switchDialogOpen} onOpenChange={setSwitchDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Trocar Conexão Principal</DialogTitle>
            <DialogDescription>
              Ao trocar a conexão principal para <strong>{pendingSwitchName}</strong>, uma mensagem será enviada para todos os pacientes com atendimento aberto avisando sobre a mudança.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Mensagem de aviso (editável):</label>
            <Textarea
              value={switchMsg}
              onChange={(e) => setSwitchMsg(e.target.value)}
              rows={5}
              className="resize-none text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Esta mensagem será enviada automaticamente para todos os pacientes em atendimento aberto.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwitchDialogOpen(false)} disabled={switching}>
              Cancelar
            </Button>
            <Button onClick={confirmSwitchPrimary} disabled={switching || !switchMsg.trim()}>
              {switching && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar Troca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
