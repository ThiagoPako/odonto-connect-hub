import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Smartphone } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { CANAIS, upsertCampanha, type Campaign, type CanalCampanha } from "@/data/campanhasStore";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { toast } from "sonner";

const AUTO_INSTANCE = "__auto__";

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
  const [instanceName, setInstanceName] = useState<string>(initial?.instanceName ?? AUTO_INSTANCE);

  const { instances, connected } = useWhatsAppInstances();

  // Resolve instância selecionada (ou "auto" → primeira conectada)
  const selectedInstance = useMemo(() => {
    if (instanceName === AUTO_INSTANCE) return connected[0];
    return instances.find((i) => i.instanceName === instanceName);
  }, [instanceName, instances, connected]);

  const resolvedNumber = useMemo(() => {
    const owner = selectedInstance?.owner;
    if (!owner) return "";
    return owner.split("@")[0].replace(/\D/g, "");
  }, [selectedInstance]);

  const isSelectedConnected = selectedInstance?.connectionState === "open";
  const usesNumberVar = /\{\{\s*number\s*\}\}/i.test(destino);
  const blockedByNumberVar = usesNumberVar && (!resolvedNumber || !isSelectedConnected);

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
      toast.error("Conecte ou selecione uma instância WhatsApp válida", {
        description: "O destino usa {{number}}, mas a instância escolhida não está conectada.",
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
      instanceName: instanceName === AUTO_INSTANCE ? undefined : instanceName,
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
              para inserir automaticamente o número da instância WhatsApp escolhida abaixo.
            </p>
          </div>

          {usesNumberVar && (
            <div className="space-y-2">
              <Label htmlFor="instance" className="flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5" />
                Instância WhatsApp para <code className="px-1 rounded bg-muted text-foreground text-xs">{`{{number}}`}</code>
              </Label>
              <Select value={instanceName} onValueChange={setInstanceName}>
                <SelectTrigger id="instance" className={blockedByNumberVar ? "border-destructive" : ""}>
                  <SelectValue placeholder="Selecione uma instância" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_INSTANCE}>
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">Automática</span>
                      <span className="text-xs text-muted-foreground">
                        (primeira conectada{connected[0] ? ` — ${connected[0].instanceName}` : ""})
                      </span>
                    </span>
                  </SelectItem>
                  {instances.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma instância cadastrada</div>
                  )}
                  {instances.map((inst) => {
                    const num = inst.owner ? inst.owner.split("@")[0].replace(/\D/g, "") : "";
                    const isOnline = inst.connectionState === "open";
                    return (
                      <SelectItem key={inst.instanceName} value={inst.instanceName}>
                        <span className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-success" : "bg-muted-foreground"}`} />
                          <span className="font-medium">{inst.instanceName}</span>
                          {num && <span className="text-xs text-muted-foreground">+{num}</span>}
                          {!isOnline && <span className="text-xs text-destructive">(offline)</span>}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              {blockedByNumberVar ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium">
                      {!selectedInstance
                        ? "Nenhuma instância WhatsApp disponível."
                        : !isSelectedConnected
                        ? `A instância "${selectedInstance.instanceName}" está desconectada.`
                        : "Instância sem número associado."}
                    </p>
                    <p className="text-destructive/80">
                      Conecte ou escolha outra instância em{" "}
                      <Link to="/canais" className="underline font-medium" onClick={() => onOpenChange(false)}>
                        Canais
                      </Link>{" "}
                      ou remova <code className="px-1 rounded bg-background">{`{{number}}`}</code> do destino.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-success flex items-center gap-1.5">
                  <span>●</span>
                  <span>
                    <code className="px-1 rounded bg-muted text-foreground">{`{{number}}`}</code> → +{resolvedNumber}{" "}
                    <span className="text-muted-foreground">({selectedInstance?.instanceName})</span>
                  </span>
                </p>
              )}
            </div>
          )}

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
