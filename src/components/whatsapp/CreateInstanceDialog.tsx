import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { whatsappApi, getAccessToken } from "@/lib/vpsApi";

interface CreateInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (instanceName: string) => void;
}

function sanitizeInstanceName(raw: string) {
  return raw.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-_]/g, "-");
}

export function CreateInstanceDialog({ open, onOpenChange, onCreated }: CreateInstanceDialogProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;

    const sanitized = sanitizeInstanceName(name);
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error("Sua sessão expirou. Saia e entre novamente.");
      }

      const { data, error: apiError } = await whatsappApi.create(sanitized);

      if (apiError) {
        if (apiError === "Unauthorized") {
          throw new Error("Sua sessão não foi aceita. Saia e entre de novo; se continuar, fale com o suporte.");
        }
        if (apiError.includes("Admin access required")) {
          throw new Error("Seu usuário não tem permissão de administrador para adicionar números WhatsApp.");
        }
        if (apiError.includes("EVOLUTION_API_KEY") || apiError.toLowerCase().includes("evolution api unauthorized")) {
          throw new Error("O serviço de WhatsApp do sistema está indisponível agora. Fale com o suporte do Odonto Connect.");
        }
        throw new Error(apiError);
      }

      const actualName = (data as any)?.instance?.instanceName || sanitized;
      onCreated?.(actualName);
      onOpenChange(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar o número");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar Número WhatsApp</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="instance-name">Nome do número</Label>
            <Input
              id="instance-name"
              placeholder="ex: recepcao"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
              aria-describedby="instance-name-hint"
            />
            {/* Antes o nome era reescrito em silêncio ("Clínica Centro" virava "cl-nica-centro")
                e havia um campo "Rótulo" que nunca era enviado. */}
            <p id="instance-name-hint" className="text-xs text-muted-foreground">
              {name.trim()
                ? <>Vai aparecer no sistema como <strong className="font-mono text-foreground">{sanitizeInstanceName(name)}</strong></>
                : "Use letras, números e hífens. Acentos e espaços viram hífen."}
            </p>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <Button onClick={handleCreate} disabled={loading || !name.trim()} className="w-full">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Criar e ler QR Code
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
