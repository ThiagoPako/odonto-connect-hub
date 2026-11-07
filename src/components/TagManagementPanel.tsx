import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tags, Plus, Trash2, Pencil, Check, X, Loader2 } from "lucide-react";
import { tagsApi, type LeadTagApi } from "@/lib/vpsApi";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";

const PRESET_COLORS = [
  "#EF4444", "#F59E0B", "#10B981", "#3B82F6",
  "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
];

const PRESET_ICONS = ["🔴", "⭐", "🔄", "🆕", "💰", "🔥", "👑", "⏳", "📌", "💎", "🎯", "❗"];

export function TagManagementPanel() {
  const [tags, setTags] = useState<LeadTagApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newIcon, setNewIcon] = useState("📌");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const loadTags = () => {
    setLoading(true);
    tagsApi.list().then(({ data, error }) => {
      setLoadError(error);
      if (!error && data) setTags(data);
      setLoading(false);
    });
  };
  useEffect(() => { loadTags(); }, []);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      toast.error("Já existe uma etiqueta com esse nome");
      return;
    }
    const { data, error } = await tagsApi.create({ name, color: newColor, icon: newIcon });
    if (error) { toast.error(error); return; }
    if (data) setTags((prev) => [...prev, data]);
    setNewName("");
    toast.success("Etiqueta criada");
  };

  const handleDelete = async (tag: LeadTagApi) => {
    const ok = await confirm({
      title: `Excluir a etiqueta "${tag.name}"?`,
      description: "Ela sai de todos os leads que a usam. Esta ação não pode ser desfeita.",
      confirmLabel: "Excluir etiqueta",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await tagsApi.delete(tag.id);
    if (error) { toast.error("Não foi possível excluir: " + error); return; }
    setTags((prev) => prev.filter((t) => t.id !== tag.id));
    toast.success("Etiqueta excluída");
  };

  const startEdit = (tag: LeadTagApi) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
    setEditIcon(tag.icon || "📌");
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    const { error } = await tagsApi.update(editingId, { name: editName.trim(), color: editColor, icon: editIcon });
    if (error) { toast.error(error); return; }
    setTags((prev) => prev.map((t) => t.id === editingId ? { ...t, name: editName.trim(), color: editColor, icon: editIcon } : t));
    setEditingId(null);
    toast.success("Tag atualizada");
  };

  if (loading) {
    return (
      <Card className="p-5 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando tags...
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Tags className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-foreground">Tags de Leads</h3>
      </div>
      <p className="text-xs text-muted-foreground">Crie tags para classificar leads no chat (ex: Urgente, VIP, Retorno)</p>

      {/* Add new */}
      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[140px]">
          <label className="text-xs text-muted-foreground mb-1 block">Nome</label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nova tag" className="h-8 text-sm" onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Ícone</label>
          <div className="flex gap-1 flex-wrap max-w-[180px]">
            {PRESET_ICONS.slice(0, 6).map((ic) => (
              <button key={ic} type="button" aria-label={`Ícone ${ic}`} aria-pressed={newIcon === ic} onClick={() => setNewIcon(ic)} className={`w-7 h-7 rounded text-sm flex items-center justify-center border transition-colors ${newIcon === ic ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>{ic}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Cor</label>
          <div className="flex gap-1">
            {PRESET_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Cor ${c}`} aria-pressed={newColor === c} onClick={() => setNewColor(c)} className={`w-6 h-6 rounded-full border-2 transition-all ${newColor === c ? "border-foreground scale-110" : "border-transparent"}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <Button size="sm" onClick={handleAdd} className="h-8 gap-1"><Plus className="h-3.5 w-3.5" />Criar</Button>
      </div>

      {/* List */}
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {tags.map((tag) => (
          <div key={tag.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 group">
            {editingId === tag.id ? (
              <>
                <span className="text-sm">{editIcon}</span>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-sm flex-1" onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
                <div className="flex gap-0.5">
                  {PRESET_COLORS.map((c) => (
                    <button key={c} type="button" aria-label={`Cor ${c}`} aria-pressed={editColor === c} onClick={() => setEditColor(c)} className={`w-4 h-4 rounded-full border ${editColor === c ? "border-foreground" : "border-transparent"}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
                <button onClick={saveEdit} aria-label="Salvar etiqueta" className="text-primary hover:text-primary/80"><Check className="h-4 w-4" /></button>
                <button onClick={() => setEditingId(null)} aria-label="Cancelar edição" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: tag.color }}>
                  {tag.icon} {tag.name}
                </span>
                <span className="flex-1" />
                {/* Visíveis no toque; só escondem até o hover em telas grandes */}
                <button onClick={() => startEdit(tag)} aria-label={`Editar etiqueta ${tag.name}`} title="Editar" className="p-1 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => handleDelete(tag)} aria-label={`Excluir etiqueta ${tag.name}`} title="Excluir" className="p-1 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
              </>
            )}
          </div>
        ))}
        {loadError ? (
          <div role="alert" className="text-xs text-destructive text-center py-4 space-y-2">
            <p>Não foi possível carregar as etiquetas. {loadError}</p>
            <Button size="sm" variant="outline" onClick={loadTags}>Tentar de novo</Button>
          </div>
        ) : !loading && tags.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhuma etiqueta criada</p>}
      </div>
      {confirmDialog}
    </Card>
  );
}
