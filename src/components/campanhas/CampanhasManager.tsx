import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Megaphone, MousePointerClick, Users, DollarSign, Trash2, Edit } from "lucide-react";
import { CANAIS, computeMetrics, deleteCampanha, getCampanhas, type Campaign } from "@/data/campanhasStore";
import { CreateCampanhaDialog } from "./CreateCampanhaDialog";
import { CampanhaDetailsDialog } from "./CampanhaDetailsDialog";
import { CampanhaSparkline } from "./CampanhaSparkline";
import { ChannelLogo } from "./ChannelLogo";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function CampanhasManager() {
  const [campanhas, setCampanhas] = useState<Campaign[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [details, setDetails] = useState<Campaign | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function refresh() {
    setCampanhas(getCampanhas());
  }

  useEffect(() => {
    refresh();
  }, []);

  function handleDelete() {
    if (!deleteId) return;
    deleteCampanha(deleteId);
    setDeleteId(null);
    refresh();
    toast.success("Campanha excluída");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Campanhas com tracking</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gere links únicos por canal e identifique automaticamente a origem dos leads no CRM.
          </p>
        </div>
        <Button
          size="default"
          onClick={() => { setEditing(null); setOpenCreate(true); }}
          className="shadow-sm hover:shadow-md transition-shadow"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nova campanha
        </Button>
      </div>

      {campanhas.length === 0 ? (
        <Card className="p-16 text-center border-dashed bg-muted/30">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Megaphone className="h-7 w-7 text-primary" />
          </div>
          <p className="font-semibold text-base">Nenhuma campanha ainda</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            Crie sua primeira campanha para gerar links de tracking e medir conversões por canal.
          </p>
          <Button className="mt-5 shadow-sm" onClick={() => setOpenCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Criar campanha
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {campanhas.map((c) => {
            const m = computeMetrics(c);
            return (
              <Card
                key={c.id}
                className="relative p-5 cursor-pointer group transition-all duration-200 hover:border-primary/60 hover:shadow-lg hover:-translate-y-0.5 overflow-hidden"
                onClick={() => setDetails(c)}
              >
                {/* Accent bar */}
                <div
                  className={`absolute inset-x-0 top-0 h-1 ${c.ativa ? "bg-gradient-to-r from-primary to-primary/40" : "bg-muted"}`}
                />

                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base leading-tight truncate">{c.nome}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                      {c.descricao || "Sem descrição"}
                    </p>
                  </div>
                  <Badge
                    variant={c.ativa ? "default" : "secondary"}
                    className={c.ativa ? "shadow-sm" : ""}
                  >
                    <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${c.ativa ? "bg-current animate-pulse" : "bg-current"}`} />
                    {c.ativa ? "Ativa" : "Pausada"}
                  </Badge>
                </div>

                {/* Channels */}
                <div className="flex flex-wrap items-center gap-1.5 mb-4">
                  {c.canais.slice(0, 5).map((canalId) => {
                    const canal = CANAIS.find((x) => x.id === canalId);
                    return (
                      <span
                        key={canalId}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-background ring-1 ring-border shadow-sm"
                        title={canal?.label}
                      >
                        <ChannelLogo canal={canalId} size={18} />
                      </span>
                    );
                  })}
                  {c.canais.length > 5 && (
                    <span className="inline-flex h-8 px-2 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-1 ring-border">
                      +{c.canais.length - 5}
                    </span>
                  )}
                </div>

                {/* Sparkline */}
                <div className="mb-4 rounded-lg bg-muted/40 p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                      Últimos 7 dias
                    </span>
                  </div>
                  <CampanhaSparkline campaign={c} days={7} height={44} />
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border">
                  <Stat icon={MousePointerClick} value={m.totalHits} label="cliques" />
                  <Stat icon={Users} value={m.leadsIdentificados} label="leads" />
                  <Stat icon={DollarSign} value={m.conversoes} label="vendas" />
                </div>

                {/* Actions — slide up on hover */}
                <div className="flex gap-2 mt-4 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1 h-8"
                    onClick={(e) => { e.stopPropagation(); setEditing(c); setOpenCreate(true); }}
                  >
                    <Edit className="h-3.5 w-3.5 mr-1.5" />
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => { e.stopPropagation(); setDeleteId(c.id); }}
                    aria-label="Excluir campanha"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CreateCampanhaDialog
        open={openCreate}
        onOpenChange={(o) => { setOpenCreate(o); if (!o) setEditing(null); }}
        initial={editing ?? undefined}
        onCreated={() => refresh()}
      />

      <CampanhaDetailsDialog open={!!details} onOpenChange={(o) => !o && setDetails(null)} campaign={details} />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Os links gerados deixarão de funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Users; value: number; label: string }) {
  return (
    <div className="text-center group/stat">
      <div className="flex items-center justify-center gap-1.5 mb-0.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover/stat:text-primary transition-colors" />
        <span className="text-base font-semibold text-foreground tabular-nums">{value}</span>
      </div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
    </div>
  );
}
