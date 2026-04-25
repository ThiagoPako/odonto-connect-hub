/**
 * MarcadoresSelector — Tags coloridas para agendamentos.
 * Inspiração: Clinicorp marcadores. Adaptado ao design system teal.
 *
 * - Lista marcadores existentes (do backend)
 * - Permite criar novos inline com seletor de cor
 * - Multi-select via chips
 * - Persiste em /agenda/marcadores
 */
import { useEffect, useState } from "react";
import { Plus, X, Tag, Loader2, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { marcadoresAgendaApi, type MarcadorAgenda } from "@/lib/vpsApi";
import { cn } from "@/lib/utils";

interface Props {
  value: MarcadorAgenda[];
  onChange: (v: MarcadorAgenda[]) => void;
  compact?: boolean; // versão pequena para popover
}

const PRESET_COLORS = [
  "#06b6d4", // cyan (primary)
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#64748b", // slate
];

export function MarcadoresSelector({ value, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [marcadores, setMarcadores] = useState<MarcadorAgenda[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    marcadoresAgendaApi.list().then(({ data }) => {
      if (Array.isArray(data)) setMarcadores(data);
    }).finally(() => setLoading(false));
  }, [open]);

  const isSelected = (m: MarcadorAgenda) => value.some((v) => v.id === m.id);

  const toggle = (m: MarcadorAgenda) => {
    if (isSelected(m)) onChange(value.filter((v) => v.id !== m.id));
    else onChange([...value, m]);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const { data, error } = await marcadoresAgendaApi.create(newName.trim(), newColor);
    setCreating(false);
    if (error) { toast.error("Erro: " + error); return; }
    if (data) {
      setMarcadores([...marcadores, data].sort((a, b) => a.nome.localeCompare(b.nome)));
      onChange([...value, data]);
      setNewName("");
      setShowCreate(false);
      toast.success("Marcador criado");
    }
  };

  return (
    <div className="space-y-1.5">
      {/* Chips selecionados + botão adicionar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((m) => (
          <span
            key={m.id}
            className={cn(
              "inline-flex items-center gap-1 rounded-full text-xs font-medium",
              "border shadow-sm transition-all",
              compact ? "px-2 py-0.5" : "px-2.5 py-1",
            )}
            style={{
              backgroundColor: m.cor + "22",
              borderColor: m.cor + "55",
              color: m.cor,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.cor }} />
            {m.nome}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v.id !== m.id))}
              className="hover:bg-black/10 rounded-full p-0.5 transition"
              aria-label={`Remover ${m.nome}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-full text-xs font-medium",
                "border border-dashed border-border hover:border-primary/60 hover:bg-accent text-muted-foreground hover:text-primary transition",
                compact ? "px-2 py-0.5" : "px-2.5 py-1",
              )}
            >
              <Tag className="h-3 w-3" />
              {value.length === 0 ? "Marcadores" : "Adicionar"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <div className="p-2 border-b border-border/60">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold px-1">
                Marcadores
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto py-1">
              {loading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loading && marcadores.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Nenhum marcador ainda
                </div>
              )}
              {!loading && marcadores.map((m) => {
                const sel = isSelected(m);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/60 transition"
                  >
                    <span
                      className={cn(
                        "h-4 w-4 rounded border-2 flex items-center justify-center transition",
                        sel ? "border-transparent" : "border-border",
                      )}
                      style={sel ? { backgroundColor: m.cor } : undefined}
                    >
                      {sel && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                    </span>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.cor }} />
                    <span className="flex-1 text-left">{m.nome}</span>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-border/60 p-2">
              {!showCreate ? (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded hover:bg-accent text-primary"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nova categoria
                </button>
              ) : (
                <div className="space-y-2">
                  <Input
                    autoFocus
                    placeholder="Nome do marcador"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    className="h-7 text-xs"
                  />
                  <div className="flex flex-wrap gap-1">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewColor(c)}
                        className={cn(
                          "h-5 w-5 rounded-full border-2 transition",
                          newColor === c ? "border-foreground scale-110" : "border-transparent hover:scale-105",
                        )}
                        style={{ backgroundColor: c }}
                        aria-label={`Cor ${c}`}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setShowCreate(false); setNewName(""); }}
                      className="h-7 px-2 text-xs flex-1"
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleCreate}
                      disabled={!newName.trim() || creating}
                      className="h-7 px-2 text-xs flex-1"
                    >
                      {creating && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      Criar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
