import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { AlertCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { CANAIS, upsertCampanha, type Campaign, type CanalCampanha } from "@/data/campanhasStore";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
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
  const [destino, setDestino] = useState(initial?.destino ?? "https://wa.me/{{number}}?text=Olá");
  const [budget, setBudget] = useState<string>(initial?.budget?.toString() ?? "");
  const [canais, setCanais] = useState<CanalCampanha[]>(initial?.canais ?? ["meta_ads", "google_ads", "tiktok"]);
  const [ativa, setAtiva] = useState(initial?.ativa ?? true);

  const { connected } = useWhatsAppInstances();
  const principalNumber = useMemo(() => {
    const owner = connected[0]?.owner;
    if (!owner) return "";
    return owner.split("@")[0].replace(/\D/g, "");
  }, [connected]);

  const usesNumberVar = /\{\{\s*number\s*\}\}/i.test(destino);
  const blockedByNumberVar = usesNumberVar && !principalNumber;

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
    if (blockedByNumberVar) {
      toast.error("Conecte uma instância WhatsApp principal antes de salvar", {
        description: "O destino usa {{number}}, mas nenhuma instância está conectada.",
      });
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
            <Input
              id="destino"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              placeholder="https://wa.me/{{number}} ou https://seusite.com/landing"
              aria-invalid={blockedByNumberVar}
              className={blockedByNumberVar ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            <p className="text-xs text-muted-foreground">
              Para onde o lead vai ao clicar no anúncio. Use{" "}
              <code className="px-1 rounded bg-muted text-foreground">{`{{number}}`}</code>{" "}
              para inserir automaticamente o número da instância WhatsApp principal conectada.
            </p>
            {blockedByNumberVar && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium">Nenhuma instância WhatsApp conectada.</p>
                  <p className="text-destructive/80">
                    O destino usa <code className="px-1 rounded bg-background">{`{{number}}`}</code>, mas não há número principal disponível.
                    Conecte uma instância em{" "}
                    <Link to="/canais" className="underline font-medium" onClick={() => onOpenChange(false)}>
                      Canais
                    </Link>{" "}
                    ou remova a variável do destino para continuar.
                  </p>
                </div>
              </div>
            )}
            {usesNumberVar && !blockedByNumberVar && (
              <p className="text-xs text-success flex items-center gap-1.5">
                <span>●</span>
                <span>{`{{number}}`} → {principalNumber}</span>
              </p>
            )}
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
          <Button
            onClick={handleSubmit}
            disabled={blockedByNumberVar}
            title={blockedByNumberVar ? "Conecte uma instância WhatsApp para usar {{number}}" : undefined}
          >
            {initial ? "Salvar" : "Criar campanha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
