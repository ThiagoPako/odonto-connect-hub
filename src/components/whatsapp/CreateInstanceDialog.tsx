import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { createInstance } from "@/lib/evolutionApi";
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

    let sanitized = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    setLoading(true);
    setError(null);

    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (userId) {
        const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', userId).maybeSingle();
        if (profile?.tenant_id) {
          // Prefix instance name with first 8 chars of tenant_id for isolation
          const tenantPrefix = profile.tenant_id.substring(0, 8);
          if (!sanitized.startsWith(tenantPrefix)) {
            sanitized = `${tenantPrefix}-${sanitized}`;
          }

          // Register in whatsapp_instances table
          const { error: regError } = await supabase.from('whatsapp_instances').insert({
            tenant_id: profile.tenant_id,
            instance_name: sanitized,
            description: label || null
          });
          
          if (regError) {
            console.error("Failed to register instance in Supabase:", regError);
          }
        }
      }
      
      await createInstance({ instanceName: sanitized });
      onCreated?.(sanitized);
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
