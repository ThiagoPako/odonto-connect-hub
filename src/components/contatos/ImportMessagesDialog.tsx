import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { vpsApiFetch } from "@/lib/vpsApi";

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
                Período selecionado:{" "}
                <span className="font-medium text-foreground">
                  {format(startDate, "dd/MM/yyyy")} — {format(endDate, "dd/MM/yyyy")}
                </span>{" "}
                ({Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1} dias)
              </p>
            </div>

            <Button onClick={handleImport} className="w-full">
              <MessageSquare className="h-4 w-4 mr-2" />
              Iniciar Importação
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
