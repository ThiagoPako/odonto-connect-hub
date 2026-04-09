import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tags, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { getTags, saveTags, type LeadTag } from "@/data/leadTags";
import { toast } from "sonner";

const PRESET_COLORS = [
  "#EF4444", "#F59E0B", "#10B981", "#3B82F6",
  "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
];

const PRESET_ICONS = ["🔴", "⭐", "🔄", "🆕", "💰", "🔥", "👑", "⏳", "📌", "💎", "🎯", "❗"];

export function TagManagementPanel() {
  const [tags, setTags] = useState<LeadTag[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newIcon, setNewIcon] = useState("📌");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editIcon, setEditIcon] = useState("");

  useEffect(() => { setTags(getTags()); }, []);

  const persist = (updated: LeadTag[]) => {
    setTags(updated);
    saveTags(updated);
  };

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      toast.error("Tag já existe");
      return;
    }
    persist([...tags, { id: `tag-${Date.now()}`, name, color: newColor, icon: newIcon }]);
    setNewName("");
    toast.success("Tag criada");
  };

  const handleDelete = (id: string) => {
    persist(tags.filter((t) => t.id !== id));
    toast.success("Tag removida");
  };

  const startEdit = (tag: LeadTag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
    setEditIcon(tag.icon || "📌");
  };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    persist(tags.map((t) => t.id === editingId ? { ...t, name: editName.trim(), color: editColor, icon: editIcon } : t));
    setEditingId(null);
    toast.success("Tag atualizada");
  };

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
              <button key={ic} onClick={() => setNewIcon(ic)} className={`w-7 h-7 rounded text-sm flex items-center justify-center border transition-colors ${newIcon === ic ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>{ic}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Cor</label>
          <div className="flex gap-1">
            {PRESET_COLORS.map((c) => (
              <button key={c} onClick={() => setNewColor(c)} className={`w-6 h-6 rounded-full border-2 transition-all ${newColor === c ? "border-foreground scale-110" : "border-transparent"}`} style={{ backgroundColor: c }} />
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
                    <button key={c} onClick={() => setEditColor(c)} className={`w-4 h-4 rounded-full border ${editColor === c ? "border-foreground" : "border-transparent"}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
                <button onClick={saveEdit} className="text-primary hover:text-primary/80"><Check className="h-4 w-4" /></button>
                <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: tag.color }}>
                  {tag.icon} {tag.name}
                </span>
                <span className="flex-1" />
                <button onClick={() => startEdit(tag)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => handleDelete(tag.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
              </>
            )}
          </div>
        ))}
        {tags.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhuma tag criada</p>}
      </div>
    </Card>
  );
}
