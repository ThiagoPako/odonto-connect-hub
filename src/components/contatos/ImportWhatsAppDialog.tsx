import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Smartphone,
  Users,
} from "lucide-react";
import { contatosApi } from "@/lib/vpsApi";

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

  const handleImport = async () => {
    setLoading(true);
    setResult(null);
    const { data, error } = await contatosApi.syncNow();
    if (error) {
      setResult({ success: false, imported: 0, totalContatos: 0, instances: [], error });
    } else if (data) {
      setResult(data as unknown as SyncResult);
      if ((data as unknown as SyncResult).imported > 0) {
        onImported();
      }
    }
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
            Busca contatos de todas as instâncias WhatsApp conectadas e salva no sistema, evitando duplicatas.
          </DialogDescription>
        </DialogHeader>

        {!result && !loading && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Smartphone className="h-8 w-8 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Clique abaixo para buscar contatos de todas as instâncias conectadas via Evolution API.
            </p>
            <Button onClick={handleImport} className="w-full">
              <Download className="h-4 w-4 mr-2" />
              Iniciar Importação
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
            {/* Summary */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              {result.success ? (
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
                      : `${result.imported} novo${result.imported !== 1 ? "s" : ""} contato${result.imported !== 1 ? "s" : ""} importado${result.imported !== 1 ? "s" : ""}`}
                </p>
                {result.totalContatos > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Total no sistema: {result.totalContatos} contatos
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
                        <span className="text-sm font-medium text-foreground truncate">
                          {inst.name}
                        </span>
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

            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleClose(false)}
            >
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
