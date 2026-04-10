import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Smartphone,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { contatosApi, whatsappApi } from "@/lib/vpsApi";
import { fetchWhatsAppContacts } from "@/lib/evolutionApi";

interface InstanceResult {
  name: string;
  imported: number;
  skipped: number;
  total: number;
  error: string | null;
}

interface SyncResult {
  success: boolean;
  imported: number;
  totalContatos: number;
  instances: InstanceResult[];
  message?: string;
  error?: string;
}

interface WaInstance {
  name: string;
  status: string;
}

interface ImportWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportWhatsAppDialog({
  open,
  onOpenChange,
  onImported,
}: ImportWhatsAppDialogProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  const [instances, setInstances] = useState<WaInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [selectedInstances, setSelectedInstances] = useState<Set<string>>(new Set());

  const loadInstances = useCallback(async () => {
    setLoadingInstances(true);
    const { data } = await whatsappApi.instances();
    const list: WaInstance[] = Array.isArray(data)
      ? data.map((i: any) => ({
          name: i.name || i.instanceName || i.instance?.instanceName,
          status: i.connectionStatus || i.status || "unknown",
        }))
      : [];
    setInstances(list);
    setSelectedInstances(new Set(list.filter((i) => i.status === "open").map((i) => i.name)));
    setLoadingInstances(false);
  }, []);

  useEffect(() => {
    if (open) void loadInstances();
  }, [open, loadInstances]);

  const toggleInstance = (name: string) => {
    setSelectedInstances((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleImport = async () => {
    setLoading(true);
    setResult(null);

    const instanceResults: InstanceResult[] = [];
    let totalImported = 0;
    let hadContacts = false;

    for (const instanceName of Array.from(selectedInstances)) {
      try {
        const contacts = await fetchWhatsAppContacts(instanceName);
        const mapped = contacts.map((contact) => ({
          telefone: contact.id,
          nome: contact.pushName?.trim() || contact.id,
        }));

        if (mapped.length > 0) hadContacts = true;

        if (mapped.length === 0) {
          instanceResults.push({
            name: instanceName,
            imported: 0,
            skipped: 0,
            total: 0,
            error: null,
          });
          continue;
        }

        const { data, error } = await contatosApi.bulkImport(mapped);
        if (error) {
          instanceResults.push({
            name: instanceName,
            imported: 0,
            skipped: 0,
            total: mapped.length,
            error,
          });
          continue;
        }

        const imported = data?.imported ?? 0;
        const skipped = data?.skipped ?? Math.max(0, mapped.length - imported);
        const total = data?.total ?? mapped.length;

        instanceResults.push({
          name: instanceName,
          imported,
          skipped,
          total,
          error: null,
        });

        totalImported += imported;
      } catch (error) {
        instanceResults.push({
          name: instanceName,
          imported: 0,
          skipped: 0,
          total: 0,
          error: error instanceof Error ? error.message : "Erro ao buscar contatos",
        });
      }
    }

    const { data: statusData } = await contatosApi.syncStatus();

    setResult({
      success: instanceResults.some((inst) => !inst.error),
      imported: totalImported,
      totalContatos: statusData?.totalContatos ?? 0,
      instances: instanceResults,
      message: !hadContacts
        ? "Nenhum contato encontrado nas instâncias selecionadas"
        : totalImported > 0
          ? undefined
          : "Nenhum novo contato importado",
    });

    if (totalImported > 0) onImported();
    setLoading(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) setResult(null);
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Importar Contatos do WhatsApp
          </DialogTitle>
          <DialogDescription>
            Busca contatos das instâncias selecionadas e salva no sistema, evitando duplicatas.
          </DialogDescription>
        </DialogHeader>

        {!result && !loading && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Instâncias WhatsApp
              </label>
              {loadingInstances ? (
                <div className="flex items-center justify-center gap-2 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Carregando instâncias...</span>
                </div>
              ) : instances.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">Nenhuma instância encontrada</p>
              ) : (
                <div className="max-h-[200px] space-y-1.5 overflow-y-auto">
                  {instances.map((inst) => {
                    const isConnected = inst.status === "open";
                    return (
                      <label
                        key={inst.name}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 transition-colors",
                          selectedInstances.has(inst.name)
                            ? "border-primary/40 bg-primary/5"
                            : "border-border hover:bg-muted/40",
                          !isConnected && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <Checkbox
                          checked={selectedInstances.has(inst.name)}
                          onCheckedChange={() => isConnected && toggleInstance(inst.name)}
                          disabled={!isConnected}
                          className="shrink-0"
                        />
                        <Smartphone className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="flex-1 truncate text-sm font-medium text-foreground">{inst.name}</span>
                        {isConnected ? (
                          <Badge
                            variant="outline"
                            className="gap-1 border-chart-2/30 bg-chart-2/10 text-[10px] text-chart-2"
                          >
                            <Wifi className="h-2.5 w-2.5" /> Conectada
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                            <WifiOff className="h-2.5 w-2.5" /> Offline
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <Button onClick={handleImport} className="w-full" disabled={selectedInstances.size === 0}>
              <Download className="mr-2 h-4 w-4" />
              {selectedInstances.size === 0
                ? "Selecione ao menos uma instância"
                : `Importar de ${selectedInstances.size} instância${selectedInstances.size !== 1 ? "s" : ""}`}
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Buscando contatos das instâncias...</p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
              {result.success ? (
                <CheckCircle2 className="h-6 w-6 shrink-0 text-chart-2" />
              ) : (
                <XCircle className="h-6 w-6 shrink-0 text-destructive" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">
                  {result.error
                    ? `Erro: ${result.error}`
                    : result.message
                      ? result.message
                      : `${result.imported} novo${result.imported !== 1 ? "s" : ""} contato${result.imported !== 1 ? "s" : ""} importado${result.imported !== 1 ? "s" : ""}`}
                </p>
                {result.totalContatos > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Total no sistema: {result.totalContatos} contatos
                  </p>
                )}
              </div>
            </div>

            {result.instances.length > 0 && (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {result.instances.map((inst) => (
                    <div
                      key={inst.name}
                      className="flex items-center justify-between rounded-lg border border-border bg-card p-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Smartphone className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate text-sm font-medium text-foreground">{inst.name}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {inst.error ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Erro
                          </Badge>
                        ) : (
                          <>
                            <Badge
                              variant="outline"
                              className="border-chart-2/30 bg-chart-2/10 text-[10px] text-chart-2"
                            >
                              +{inst.imported}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {inst.skipped} exist.
                            </Badge>
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {inst.total} total
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            <Button variant="outline" className="w-full" onClick={() => handleClose(false)}>
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
