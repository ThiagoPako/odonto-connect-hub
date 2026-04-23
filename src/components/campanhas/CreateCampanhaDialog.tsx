import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { CANAIS, upsertCampanha, type Campaign, type CanalCampanha } from "@/data/campanhasStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (c: Campaign) => void;
  initial?: Campaign;
}

export function CreateCampanhaDialog({ open, onOpenChange, onCreated, initial }: Props) {
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [descricao, setDescricao] = useState(initial?.descricao ?? "");
  const [destino, setDestino] = useState(initial?.destino ?? "https://wa.me/5511999990000?text=Olá");
  const [budget, setBudget] = useState<string>(initial?.budget?.toString() ?? "");
  const [canais, setCanais] = useState<CanalCampanha[]>(initial?.canais ?? ["meta_ads", "google_ads", "tiktok"]);
  const [ativa, setAtiva] = useState(initial?.ativa ?? true);

  function toggleCanal(id: CanalCampanha) {
    setCanais((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  function handleSubmit() {
    if (!nome.trim()) {
      toast.error("Informe um nome para a campanha");
      return;
    }
    if (!destino.trim()) {
      toast.error("Informe o destino (URL ou link do WhatsApp)");
      return;
    }
    if (canais.length === 0) {
      toast.error("Selecione pelo menos um canal");
      return;
    }
    const camp: Campaign = {
      id: initial?.id ?? `camp-${Date.now()}`,
      nome: nome.trim(),
      descricao: descricao.trim(),
      destino: destino.trim(),
      canais,
      ativa,
      budget: budget ? Number(budget) : undefined,
      criadaEm: initial?.criadaEm ?? Date.now(),
      hits: initial?.hits ?? [],
    };
    upsertCampanha(camp);
    toast.success(initial ? "Campanha atualizada" : "Campanha criada — links de tracking gerados!");
    onCreated?.(camp);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar Campanha" : "Nova Campanha"}</DialogTitle>
          <DialogDescription>
            Crie uma campanha e gere links únicos com UTM para cada canal. Quando alguém clicar no link e
            virar lead, ele será automaticamente marcado com a tag de origem no CRM.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome da campanha</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Implantes Outono 2026" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao">Descrição</Label>
            <Textarea id="descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Breve descrição da campanha" rows={2} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="destino">URL de destino</Label>
            <Input id="destino" value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="https://wa.me/5511... ou https://seusite.com/landing" />
            <p className="text-xs text-muted-foreground">
              Para onde o lead vai ao clicar no anúncio. Aceita links de WhatsApp, landing pages, formulários, etc.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="budget">Investimento previsto (R$)</Label>
              <Input id="budget" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="5000" />
            </div>
            <div className="space-y-2 flex flex-col">
              <Label>Status</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={ativa} onCheckedChange={setAtiva} />
                <span className="text-sm">{ativa ? "Ativa" : "Pausada"}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Canais de divulgação</Label>
            <p className="text-xs text-muted-foreground">Selecione onde a campanha vai rodar — um link único será gerado para cada canal.</p>
            <div className="grid grid-cols-2 gap-2 pt-2">
              {CANAIS.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 rounded-md border border-border p-2 cursor-pointer hover:bg-accent transition-colors"
                >
                  <Checkbox checked={canais.includes(c.id)} onCheckedChange={() => toggleCanal(c.id)} />
                  <span className="text-lg">{c.icon}</span>
                  <span className="text-sm font-medium">{c.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit}>{initial ? "Salvar" : "Criar campanha"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
