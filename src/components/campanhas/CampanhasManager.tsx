import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Megaphone, MousePointerClick, Users, DollarSign, Trash2, Edit } from "lucide-react";
import { CANAIS, computeMetrics, deleteCampanha, getCampanhas, type Campaign } from "@/data/campanhasStore";
import { CreateCampanhaDialog } from "./CreateCampanhaDialog";
import { CampanhaDetailsDialog } from "./CampanhaDetailsDialog";
import { CampanhaSparkline } from "./CampanhaSparkline";
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Campanhas com tracking</h2>
          <p className="text-sm text-muted-foreground">
            Gere links únicos por canal e identifique automaticamente a origem dos leads no CRM.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setOpenCreate(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Nova campanha
        </Button>
      </div>

      {campanhas.length === 0 ? (
        <Card className="p-12 text-center">
          <Megaphone className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">Nenhuma campanha ainda</p>
          <p className="text-sm text-muted-foreground mt-1">Crie sua primeira campanha para gerar links de tracking.</p>
          <Button className="mt-4" onClick={() => setOpenCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Criar campanha
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campanhas.map((c) => {
            const m = computeMetrics(c);
            return (
              <Card
                key={c.id}
                className="p-4 cursor-pointer hover:border-primary transition-colors group"
                onClick={() => setDetails(c)}
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{c.nome}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                      {c.descricao || "Sem descrição"}
                    </p>
                  </div>
                  <Badge variant={c.ativa ? "default" : "secondary"}>{c.ativa ? "Ativa" : "Pausada"}</Badge>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {c.canais.slice(0, 5).map((canalId) => {
                    const canal = CANAIS.find((x) => x.id === canalId);
                    return (
                      <span key={canalId} className="text-lg" title={canal?.label}>
                        {canal?.icon}
                      </span>
                    );
                  })}
                  {c.canais.length > 5 && (
                    <span className="text-xs text-muted-foreground self-center ml-1">+{c.canais.length - 5}</span>
                  )}
                </div>

                </div>

                <div className="mb-2 -mx-1">
                  <div className="flex items-center justify-between px-1 mb-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Últimos 7 dias</span>
                  </div>
                  <CampanhaSparkline campaign={c} days={7} height={48} />
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3 pt-3 border-t border-border">
                  <Stat icon={MousePointerClick} value={m.totalHits} label="cliques" />
                  <Stat icon={Users} value={m.leadsIdentificados} label="leads" />
                  <Stat icon={DollarSign} value={m.conversoes} label="vendas" />
                </div>

                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={(e) => { e.stopPropagation(); setEditing(c); setOpenCreate(true); }}
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); setDeleteId(c.id); }}
                  >
                    <Trash2 className="h-3 w-3" />
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
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Users; value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="text-sm font-semibold text-foreground">{value}</span>
      </div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
    </div>
  );
}
