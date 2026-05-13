import { useState, useEffect } from "react";
import { saasApi, type Plan } from "@/lib/saasApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

interface PlanEditorDialogProps {
  plan?: Plan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function PlanEditorDialog({ plan, open, onOpenChange, onSuccess }: PlanEditorDialogProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<Plan>>({
    nome: "",
    slug: "",
    descricao: "",
    preco_mensal: 0,
    trial_days: 14,
    max_usuarios: null,
    max_dentistas: null,
    max_pacientes: null,
    max_whatsapp_instances: null,
    ativo: true,
    display_order: 0,
  });

  useEffect(() => {
    if (plan) {
      setFormData(plan);
    } else {
      setFormData({
        nome: "",
        slug: "",
        descricao: "",
        preco_mensal: 0,
        trial_days: 14,
        max_usuarios: null,
        max_dentistas: null,
        max_pacientes: null,
        max_whatsapp_instances: null,
        ativo: true,
        display_order: 0,
      });
    }
  }, [plan, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (plan?.id) {
        const res = await saasApi.updatePlan(plan.id, formData);
        if (res.error) throw new Error(res.error);
        toast.success("Plano atualizado com sucesso");
      } else {
        const res = await saasApi.createPlan(formData);
        if (res.error) throw new Error(res.error);
        toast.success("Plano criado com sucesso");
      }
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar plano");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[95vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{plan ? "Editar Plano" : "Novo Plano"}</DialogTitle>
            <DialogDescription>
              Configure os módulos, detalhes e limites do plano SaaS.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nome">Nome do Plano</Label>
                <Input
                  id="nome"
                  value={formData.nome || ""}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  placeholder="Ex: Profissional"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug (URL)</Label>
                <Input
                  id="slug"
                  value={formData.slug || ""}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  placeholder="ex: profissional"
                  disabled={!!plan}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="descricao">Descrição</Label>
              <Textarea
                id="descricao"
                value={formData.descricao || ""}
                onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                placeholder="Resumo das vantagens deste plano..."
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="preco">Preço Mensal (R$)</Label>
                <Input
                  id="preco"
                  type="number"
                  value={formData.preco_mensal || 0}
                  onChange={(e) => setFormData({ ...formData, preco_mensal: Number(e.target.value) })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="trial">Dias de Teste</Label>
                <Input
                  id="trial"
                  type="number"
                  value={formData.trial_days || 0}
                  onChange={(e) => setFormData({ ...formData, trial_days: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order">Ordem de Exibição</Label>
                <Input
                  id="order"
                  type="number"
                  value={formData.display_order || 0}
                  onChange={(e) => setFormData({ ...formData, display_order: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-bold mb-3 uppercase tracking-wider text-muted-foreground">Limites de Recursos</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="max_usuarios">Máx. Usuários (0 para ilimitado)</Label>
                  <Input
                    id="max_usuarios"
                    type="number"
                    value={formData.max_usuarios || ""}
                    onChange={(e) => setFormData({ ...formData, max_usuarios: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max_dentistas">Máx. Dentistas (0 para ilimitado)</Label>
                  <Input
                    id="max_dentistas"
                    type="number"
                    value={formData.max_dentistas || ""}
                    onChange={(e) => setFormData({ ...formData, max_dentistas: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max_pacientes">Máx. Pacientes (0 para ilimitado)</Label>
                  <Input
                    id="max_pacientes"
                    type="number"
                    value={formData.max_pacientes || ""}
                    onChange={(e) => setFormData({ ...formData, max_pacientes: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max_whatsapp">Máx. WhatsApp (0 para ilimitado)</Label>
                  <Input
                    id="max_whatsapp"
                    type="number"
                    value={formData.max_whatsapp_instances || ""}
                    onChange={(e) => setFormData({ ...formData, max_whatsapp_instances: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 border-t pt-4">
              <Switch
                id="ativo"
                checked={formData.ativo}
                onCheckedChange={(checked) => setFormData({ ...formData, ativo: checked })}
              />
              <Label htmlFor="ativo">Plano Ativo (disponível para novas assinaturas)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {plan ? "Salvar Alterações" : "Criar Plano"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
