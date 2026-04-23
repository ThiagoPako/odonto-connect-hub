import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, ExternalLink, TrendingUp, Users, Target, DollarSign, Check, Settings2 } from "lucide-react";
import { CANAIS, buildTrackingLink, computeMetrics, type Campaign, type CanalCampanha, type UtmExtras } from "@/data/campanhasStore";
import { CampanhaTimelineChart } from "./CampanhaTimelineChart";
import { CampanhaLeadsTable } from "./CampanhaLeadsTable";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
}

export function CampanhaDetailsDialog({ open, onOpenChange, campaign }: Props) {
  const [copiedCanal, setCopiedCanal] = useState<CanalCampanha | null>(null);
  const [extrasByCanal, setExtrasByCanal] = useState<Record<string, UtmExtras>>({});
  const [openExtras, setOpenExtras] = useState<Record<string, boolean>>({});

  const metrics = useMemo(() => (campaign ? computeMetrics(campaign) : null), [campaign]);

  if (!campaign || !metrics) return null;

  function getExtras(canal: CanalCampanha): UtmExtras {
    return extrasByCanal[canal] ?? {};
  }
  function setExtras(canal: CanalCampanha, patch: Partial<UtmExtras>) {
    setExtrasByCanal((prev) => ({ ...prev, [canal]: { ...prev[canal], ...patch } }));
  }

  async function copyLink(canal: CanalCampanha) {
    if (!campaign) return;
    const link = buildTrackingLink(campaign, canal, getExtras(canal));
    try {
      await navigator.clipboard.writeText(link);
      setCopiedCanal(canal);
      toast.success(`Link de ${CANAIS.find((c) => c.id === canal)?.label} copiado!`);
      setTimeout(() => setCopiedCanal(null), 2000);
    } catch {
      toast.error("Não foi possível copiar — copie manualmente");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="text-xl">{campaign.nome}</DialogTitle>
              <DialogDescription className="mt-1">{campaign.descricao || "Sem descrição"}</DialogDescription>
            </div>
            <Badge variant={campaign.ativa ? "default" : "secondary"}>{campaign.ativa ? "Ativa" : "Pausada"}</Badge>
          </div>
        </DialogHeader>

        <Tabs defaultValue="links" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="links">Links de tracking</TabsTrigger>
            <TabsTrigger value="metricas">Métricas</TabsTrigger>
            <TabsTrigger value="leads">Leads recebidos</TabsTrigger>
          </TabsList>

          {/* LINKS */}
          <TabsContent value="links" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[50vh] pr-3">
              <div className="space-y-3">
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <p className="font-medium mb-1">Como funciona</p>
                  <p className="text-muted-foreground text-xs">
                    Cada canal tem um link único com parâmetros UTM. Use o link correspondente no anúncio de cada plataforma.
                    Quando alguém clicar e virar lead, o sistema marca automaticamente a origem no CRM.
                  </p>
                </div>

                {campaign.canais.map((canalId) => {
                  const canal = CANAIS.find((c) => c.id === canalId);
                  if (!canal) return null;
                  const extras = getExtras(canalId);
                  const link = buildTrackingLink(campaign, canalId, extras);
                  const hits = metrics.porCanal[canalId] ?? 0;
                  const isCopied = copiedCanal === canalId;
                  const isExtrasOpen = openExtras[canalId] ?? false;
                  const hasExtras = !!(extras.term || extras.id);
                  return (
                    <div key={canalId} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-2xl shrink-0">{canal.icon}</span>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{canal.label}</p>
                            <p className="text-xs text-muted-foreground">{hits} clique{hits !== 1 ? "s" : ""}</p>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant={isExtrasOpen || hasExtras ? "secondary" : "ghost"}
                            onClick={() => setOpenExtras((p) => ({ ...p, [canalId]: !isExtrasOpen }))}
                            title="Parâmetros extras (utm_term, utm_id)"
                          >
                            <Settings2 className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => window.open(link, "_blank")}>
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                          <Button size="sm" onClick={() => copyLink(canalId)} variant={isCopied ? "default" : "secondary"}>
                            {isCopied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                            {isCopied ? "Copiado" : "Copiar link"}
                          </Button>
                        </div>
                      </div>

                      {isExtrasOpen && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <div className="space-y-1">
                            <Label htmlFor={`term-${canalId}`} className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              utm_term <span className="normal-case">(palavra-chave)</span>
                            </Label>
                            <Input
                              id={`term-${canalId}`}
                              value={extras.term ?? ""}
                              onChange={(e) => setExtras(canalId, { term: e.target.value })}
                              placeholder="ex: implante-dentario"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`id-${canalId}`} className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              utm_id <span className="normal-case">(ID do anúncio)</span>
                            </Label>
                            <Input
                              id={`id-${canalId}`}
                              value={extras.id ?? ""}
                              onChange={(e) => setExtras(canalId, { id: e.target.value })}
                              placeholder="ex: adset_123"
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      )}

                      <div className="rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground break-all">
                        {link}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* METRICAS */}
          <TabsContent value="metricas" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[50vh] pr-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <MetricCard icon={Users} label="Cliques totais" value={metrics.totalHits.toString()} />
                <MetricCard icon={Target} label="Leads identificados" value={metrics.leadsIdentificados.toString()} />
                <MetricCard icon={TrendingUp} label="Conversões" value={metrics.conversoes.toString()} />
                <MetricCard icon={DollarSign} label="Receita" value={`R$ ${metrics.receita.toLocaleString("pt-BR")}`} />
              </div>

              <div className="mb-4">
                <CampanhaTimelineChart campaign={campaign} />
              </div>

              <div className="rounded-lg border border-border p-4">
                <h4 className="font-medium text-sm mb-3">Performance por canal</h4>
                <div className="space-y-2">
                  {campaign.canais.map((canalId) => {
                    const canal = CANAIS.find((c) => c.id === canalId);
                    if (!canal) return null;
                    const hits = metrics.porCanal[canalId] ?? 0;
                    const pct = metrics.totalHits > 0 ? (hits / metrics.totalHits) * 100 : 0;
                    return (
                      <div key={canalId} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <span>{canal.icon}</span>
                            <span>{canal.label}</span>
                          </span>
                          <span className="font-medium">{hits} ({pct.toFixed(0)}%)</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {campaign.budget && metrics.leadsIdentificados > 0 && (
                <div className="mt-4 rounded-lg border border-border p-4">
                  <h4 className="font-medium text-sm mb-2">ROI</h4>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Investido</p>
                      <p className="font-semibold">R$ {campaign.budget.toLocaleString("pt-BR")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">CPL (custo por lead)</p>
                      <p className="font-semibold">R$ {(campaign.budget / metrics.leadsIdentificados).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">ROI</p>
                      <p className={`font-semibold ${metrics.receita > campaign.budget ? "text-success" : "text-destructive"}`}>
                        {(((metrics.receita - campaign.budget) / campaign.budget) * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* LEADS */}
          <TabsContent value="leads" className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-[50vh] pr-3">
              <CampanhaLeadsTable campaign={campaign} onNavigate={() => onOpenChange(false)} />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-4 w-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
