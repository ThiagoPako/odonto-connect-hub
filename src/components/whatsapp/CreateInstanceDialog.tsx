import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { whatsappApi } from "@/lib/vpsApi";
import { createInstance, registerWebhook } from "@/lib/evolutionApi";
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
      // Create via VPS API so it manages the prefix and registers webhooks
      const { data, error: apiError } = await whatsappApi.create(sanitized);
      
      if (apiError) {
        if (apiError.includes("Unauthorized") || apiError.includes("Sessão expirada")) {
          const actualName = await createDirectEvolutionInstance(sanitized);
          onCreated?.(actualName);
          onOpenChange(false);
          setName("");
          setLabel("");
          return;
        }

        const authMessage = apiError.includes("Admin access required")
          ? "Seu usuário está logado, mas não tem permissão de administrador para adicionar números WhatsApp."
          : apiError;
        throw new Error(authMessage);
      }
      
      // The VPS might have prepended a prefix, let's use the actual name returned if possible
      // but usually sanitized is already correct if the user entered it.
      // Evolution API create returns { instance: { instanceName: ... } }
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

async function createDirectEvolutionInstance(instanceName: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Faça login novamente para adicionar o número.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  const tenantId = profile?.tenant_id || null;
  const finalName = tenantId && !instanceName.startsWith(tenantId.substring(0, 8))
    ? `${tenantId.substring(0, 8)}-${instanceName}`
    : instanceName;

  const data = await createInstance({ instanceName: finalName });
  await registerWebhook(finalName).catch(() => undefined);

  if (tenantId) {
    await supabase
      .from("whatsapp_instances")
      .upsert({ instance_name: finalName, tenant_id: tenantId }, { onConflict: "instance_name" })
      .then(({ error }) => {
        if (error) console.warn("Failed to save WhatsApp instance mapping", error.message);
      });
  }

  return (data as any)?.instance?.instanceName || finalName;
}
