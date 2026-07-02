import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { whatsappApi, getAccessToken } from "@/lib/vpsApi";
import { supabase } from "@/integrations/supabase/client";

interface CreateInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (instanceName: string) => void;
}

export function CreateInstanceDialog({ open, onOpenChange, onCreated }: CreateInstanceDialogProps) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;

    const sanitized = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    setLoading(true);
    setError(null);

    try {
      // 1) Garante um access_token Supabase válido (força refresh).
      await supabase.auth.refreshSession().catch(() => null);
      const token = await getAccessToken(true);
      if (!token) {
        throw new Error("Sua sessão expirou. Saia e entre novamente.");
      }

      // 2) Cria a instância direto no backend.
      // Não usamos /auth/me aqui: essa rota depende do profile local da VPS e
      // pode retornar "Perfil não encontrado" mesmo com sessão Supabase válida,
      // bloqueando indevidamente a geração do QR Code.
      let { data, error: apiError } = await whatsappApi.create(sanitized);
      if (apiError === "Unauthorized") {
        await supabase.auth.refreshSession().catch(() => null);
        ({ data, error: apiError } = await whatsappApi.create(sanitized));
      }

      if (apiError) {
        if (apiError === "Unauthorized") {
          throw new Error("A VPS recusou o token nesta rota. Faça logout/login e tente novamente.");
        }
        if (apiError.includes("Admin access required")) {
          throw new Error("Seu usuário não tem permissão de administrador para adicionar números WhatsApp.");
        }
        if (apiError.includes("EVOLUTION_API_KEY") || apiError.toLowerCase().includes("evolution api unauthorized")) {
          throw new Error("Evolution API recusou a chave da VPS. Verifique EVOLUTION_API_KEY no .env do VPS.");
        }
        throw new Error(apiError);
      }

      const actualName = (data as any)?.instance?.instanceName || sanitized;
      onCreated?.(actualName);
      onOpenChange(false);
      setName("");
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar instância");
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
            <Label htmlFor="instance-name">Nome da instância</Label>
            <Input
              id="instance-name"
              placeholder="ex: clinica-principal"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Identificador único (letras, números e hífens)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="instance-label">Rótulo (opcional)</Label>
            <Input
              id="instance-label"
              placeholder="ex: Número Principal"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={handleCreate} disabled={loading || !name.trim()} className="w-full">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Criar e Conectar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
