import { useState, useEffect, useCallback } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  MessageSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  Smartphone,
  CalendarIcon,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { whatsappApi, getToken } from "@/lib/vpsApi";

interface InstanceResult {
  name: string;
  imported: number;
  skipped: number;
  contacts: number;
  error: string | null;
}

interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  instances: InstanceResult[];
  message?: string;
  error?: string;
}

interface WaInstance {
  name: string;
  status: string;
  profilePictureUrl?: string;
}

interface ImportMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

const PERIOD_PRESETS = [
  { label: "Últimos 7 dias", days: 7 },
  { label: "Últimos 15 dias", days: 15 },
  { label: "Últimos 30 dias", days: 30 },
  { label: "Últimos 90 dias", days: 90 },
];

export function ImportMessagesDialog({
  open,
  onOpenChange,
  onImported,
}: ImportMessagesDialogProps) {
  const [startDate, setStartDate] = useState<Date>(subDays(new Date(), 7));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Instance selection
  const [instances, setInstances] = useState<WaInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [selectedInstances, setSelectedInstances] = useState<Set<string>>(new Set());

  const loadInstances = useCallback(async () => {
    setLoadingInstances(true);
    const { data } = await whatsappApi.instances();
    const list: WaInstance[] = Array.isArray(data) ? data.map((i: any) => ({
      name: i.name || i.instanceName || i.instance?.instanceName,
      status: i.connectionStatus || i.status || 'unknown',
    })) : [];
    setInstances(list);
    // Select all connected by default
    setSelectedInstances(new Set(list.filter(i => i.status === 'open').map(i => i.name)));
    setLoadingInstances(false);
  }, []);

  useEffect(() => {
    if (open) void loadInstances();
  }, [open, loadInstances]);

  const toggleInstance = (name: string) => {
    setSelectedInstances(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const applyPreset = (days: number) => {
    setStartDate(subDays(new Date(), days));
    setEndDate(new Date());
  };

  const handleImport = async () => {
    setLoading(true);
    setResult(null);
    const { data, error } = await vpsApiFetch<ImportResult>("/messages/import-whatsapp", {
      method: "POST",
      body: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        instances: Array.from(selectedInstances),
      },
    });
    if (error) {
      setResult({ success: false, imported: 0, skipped: 0, instances: [], error });
    } else if (data) {
      setResult(data);
      if (data.imported > 0) onImported?.();
    }
    setLoading(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) setResult(null);
    onOpenChange(v);
  };

  const connectedInstances = instances.filter(i => i.status === 'open');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Importar Mensagens do WhatsApp
          </DialogTitle>
          <DialogDescription>
            Importa o histórico de mensagens de todas as instâncias conectadas para o período selecionado.
          </DialogDescription>
        </DialogHeader>

        {!result && !loading && (
          <div className="space-y-4">
            {/* Instance selection */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Instâncias WhatsApp
              </label>
              {loadingInstances ? (
                <div className="flex items-center gap-2 py-3 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Carregando instâncias...</span>
                </div>
              ) : instances.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">Nenhuma instância encontrada</p>
              ) : (
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                  {instances.map((inst) => {
                    const isConnected = inst.status === 'open';
                    return (
                      <label
                        key={inst.name}
                        className={cn(
                          "flex items-center gap-2.5 p-2 rounded-lg border transition-colors cursor-pointer",
                          selectedInstances.has(inst.name)
                            ? "border-primary/40 bg-primary/5"
                            : "border-border hover:bg-muted/40",
                          !isConnected && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <Checkbox
                          checked={selectedInstances.has(inst.name)}
                          onCheckedChange={() => isConnected && toggleInstance(inst.name)}
                          disabled={!isConnected}
                          className="shrink-0"
                        />
                        <Smartphone className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate flex-1">{inst.name}</span>
                        {isConnected ? (
                          <Badge variant="outline" className="text-[10px] bg-chart-2/10 text-chart-2 border-chart-2/30 gap-1">
                            <Wifi className="h-2.5 w-2.5" /> Conectada
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground gap-1">
                            <WifiOff className="h-2.5 w-2.5" /> Offline
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Period presets */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Período rápido
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {PERIOD_PRESETS.map((p) => (
                  <Button
                    key={p.days}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => applyPreset(p.days)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Date range pickers */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Data início
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal h-9 text-sm",
                        !startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                      {startDate ? format(startDate, "dd/MM/yyyy") : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={(d) => d && setStartDate(d)}
                      disabled={(d) => d > new Date()}
                      locale={ptBR}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Data fim
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal h-9 text-sm",
                        !endDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                      {endDate ? format(endDate, "dd/MM/yyyy") : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={(d) => d && setEndDate(d)}
                      disabled={(d) => d > new Date() || d < startDate}
                      locale={ptBR}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                Período: <span className="font-medium text-foreground">
                  {format(startDate, "dd/MM/yyyy")} — {format(endDate, "dd/MM/yyyy")}
                </span>{" "}
                ({Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1} dias)
                {" · "}{selectedInstances.size} instância{selectedInstances.size !== 1 ? "s" : ""} selecionada{selectedInstances.size !== 1 ? "s" : ""}
              </p>
            </div>

            <Button onClick={handleImport} className="w-full" disabled={selectedInstances.size === 0}>
              <MessageSquare className="h-4 w-4 mr-2" />
              {selectedInstances.size === 0 ? "Selecione ao menos uma instância" : "Iniciar Importação"}
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Importando mensagens... isso pode demorar alguns minutos.
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              {result.success && !result.error ? (
                <CheckCircle2 className="h-6 w-6 text-chart-2 shrink-0" />
              ) : (
                <XCircle className="h-6 w-6 text-destructive shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">
                  {result.error
                    ? `Erro: ${result.error}`
                    : result.message
                      ? result.message
                      : `${result.imported} mensagen${result.imported !== 1 ? "s" : ""} importada${result.imported !== 1 ? "s" : ""}`}
                </p>
                {result.skipped > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {result.skipped} mensagen{result.skipped !== 1 ? "s" : ""} já existente{result.skipped !== 1 ? "s" : ""} (ignoradas)
                  </p>
                )}
              </div>
            </div>

            {/* Per-instance details */}
            {result.instances.length > 0 && (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {result.instances.map((inst) => (
                    <div
                      key={inst.name}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Smartphone className="h-4 w-4 text-primary shrink-0" />
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-foreground truncate block">
                            {inst.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {inst.contacts} contato{inst.contacts !== 1 ? "s" : ""} verificado{inst.contacts !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {inst.error ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Erro
                          </Badge>
                        ) : (
                          <>
                            <Badge variant="outline" className="text-[10px] bg-chart-2/10 text-chart-2 border-chart-2/30">
                              +{inst.imported}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {inst.skipped} exist.
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setResult(null)}
              >
                Importar outro período
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleClose(false)}
              >
                Fechar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
