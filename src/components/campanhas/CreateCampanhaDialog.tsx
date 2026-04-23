import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Wifi, WifiOff, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AUTO_INSTANCE, CANAIS, upsertCampanha, type Campaign, type CanalCampanha } from "@/data/campanhasStore";
import { ChannelBadge } from "./ChannelLogo";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (c: Campaign) => void;
  initial?: Campaign;
}

function ownerToNumber(owner?: string): string {
  if (!owner) return "";
  return owner.split("@")[0].replace(/\D/g, "");
}

export function CreateCampanhaDialog({ open, onOpenChange, onCreated, initial }: Props) {
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [descricao, setDescricao] = useState(initial?.descricao ?? "");
  const [destino, setDestino] = useState(initial?.destino ?? "https://wa.me/{{number}}?text=Olá");
  const [budget, setBudget] = useState<string>(initial?.budget?.toString() ?? "");
  const [canais, setCanais] = useState<CanalCampanha[]>(initial?.canais ?? ["meta_ads", "google_ads", "tiktok"]);
  const [ativa, setAtiva] = useState(initial?.ativa ?? true);
  const [instanceName, setInstanceName] = useState<string>(initial?.instanceName ?? AUTO_INSTANCE);

  const { instances, connected } = useWhatsAppInstances({ active: open });

  const usesNumberVar = /\{\{\s*number\s*\}\}/i.test(destino);

  // Resolve a instância selecionada para preview/validação
  const selectedInstance = useMemo(() => {
    if (instanceName === AUTO_INSTANCE) return connected[0];
    return instances.find((i) => i.instanceName === instanceName);
  }, [instanceName, instances, connected]);

  const resolvedNumber = ownerToNumber(selectedInstance?.owner);
  const isSelectedConnected = selectedInstance?.connectionState === "open";

  // Bloqueio: usa {{number}} mas não há número resolvível
  const blockedByNumberVar = usesNumberVar && (!selectedInstance || !isSelectedConnected || !resolvedNumber);

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
      toast.error("A instância selecionada não está conectada", {
        description: "Escolha outra instância conectada ou remova {{number}} do destino.",
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
      instanceName: usesNumberVar ? instanceName : undefined,
      lastResolvedInstance: initial?.lastResolvedInstance,
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
              para inserir automaticamente o número da instância WhatsApp escolhida.
            </p>
          </div>

          {/* Seletor de instância — só aparece se usa {{number}} */}
          {usesNumberVar && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <Label htmlFor="instance" className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Instância WhatsApp para <code className="px-1 rounded bg-background text-xs">{`{{number}}`}</code>
              </Label>
              <Select value={instanceName} onValueChange={setInstanceName}>
                <SelectTrigger id="instance">
                  <SelectValue placeholder="Selecione uma instância" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_INSTANCE}>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      <span>Automática (primeira conectada)</span>
                    </div>
                  </SelectItem>
                  {instances.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma instância cadastrada</div>
                  )}
                  {instances.map((inst) => {
                    const online = inst.connectionState === "open";
                    const num = ownerToNumber(inst.owner);
                    return (
                      <SelectItem key={inst.instanceName} value={inst.instanceName}>
                        <div className="flex items-center gap-2">
                          {online ? (
                            <Wifi className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className="font-medium">{inst.instanceName}</span>
                          {num && <span className="text-xs text-muted-foreground">({num})</span>}
                          {!online && <span className="text-[10px] uppercase text-muted-foreground">offline</span>}
                        </div>
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
                        ? "Nenhuma instância selecionada disponível."
                        : !isSelectedConnected
                          ? `"${selectedInstance.instanceName}" está desconectada.`
                          : "Não foi possível obter o número."}
                    </p>
                    <p className="text-destructive/80">
                      Escolha outra instância conectada ou conecte uma em{" "}
                      <Link to="/canais" className="underline font-medium" onClick={() => onOpenChange(false)}>
                        Canais
                      </Link>.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-success flex items-center gap-1.5">
                  <Wifi className="h-3 w-3" />
                  <span>
                    {`{{number}}`} → <strong>{resolvedNumber}</strong>
                    {selectedInstance && (
                      <span className="text-muted-foreground"> ({selectedInstance.instanceName})</span>
                    )}
                  </span>
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                A escolha é salva na campanha. Se a instância cair, será oferecido fallback automático para a próxima conectada.
              </p>
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
              {CANAIS.map((c) => {
                const checked = canais.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex items-center gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-all ${
                      checked
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:bg-accent hover:border-accent-foreground/20"
                    }`}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggleCanal(c.id)} />
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-background ring-1 ring-border shrink-0">
                      <ChannelLogo canal={c.id} size={16} />
                    </span>
                    <span className="text-sm font-medium truncate">{c.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={blockedByNumberVar}
            title={blockedByNumberVar ? "Selecione uma instância WhatsApp conectada" : undefined}
          >
            {initial ? "Salvar" : "Criar campanha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
