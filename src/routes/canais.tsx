import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { InstanceCard } from "@/components/whatsapp/InstanceCard";
import { QrCodeDialog } from "@/components/whatsapp/QrCodeDialog";
import { CreateInstanceDialog } from "@/components/whatsapp/CreateInstanceDialog";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCw, Loader2, WifiOff } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { fetchInstances, getInstanceState, type EvolutionInstance } from "@/lib/evolutionApi";

export const Route = createFileRoute("/canais")({
  ssr: false,
  component: CanaisPage,
});

interface InstanceWithState extends EvolutionInstance {
  connectionState: "open" | "close" | "connecting";
}

function CanaisPage() {
  const [instances, setInstances] = useState<InstanceWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [qrInstance, setQrInstance] = useState<string | null>(null);

  const loadInstances = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchInstances();
      const withState = await Promise.all(
        list.map(async (inst) => {
          try {
            const state = await getInstanceState(inst.instanceName);
            return { ...inst, connectionState: state.state };
          } catch {
            return { ...inst, connectionState: "close" as const };
          }
        })
      );
      setInstances(withState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar instâncias");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  const handleCreated = (name: string) => {
    loadInstances();
    setQrInstance(name);
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Canais WhatsApp" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Números Conectados</h2>
            <p className="text-sm text-muted-foreground">
              Gerencie múltiplos números WhatsApp via Evolution API
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadInstances} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Número
            </Button>
          </div>
        </div>

        {loading && instances.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <WifiOff className="h-10 w-10 text-destructive" />
            <p className="text-sm text-destructive text-center max-w-md">{error}</p>
            <Button variant="outline" size="sm" onClick={loadInstances}>
              Tentar novamente
            </Button>
          </div>
        ) : instances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-sm text-muted-foreground">Nenhum número conectado</p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Conectar primeiro número
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {instances.map((inst) => (
              <InstanceCard
                key={inst.instanceId}
                instanceName={inst.instanceName}
                instanceId={inst.instanceId}
                status={inst.connectionState}
                onConnect={(name) => setQrInstance(name)}
                onRefresh={loadInstances}
              />
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
          onConnected={loadInstances}
        />
      )}
    </div>
  );
}
