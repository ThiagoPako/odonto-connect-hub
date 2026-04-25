/**
 * Catálogo de Procedimentos — Fase B/C
 * CRUD completo dos procedimentos que serão usados em orçamentos e execuções.
 */
import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Loader2, Search } from "lucide-react";
import { procedimentosCatalogoApi, type ProcedimentoCatalogo } from "@/lib/vpsApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/procedimentos")({
  ssr: false,
  component: ProcedimentosCatalogoPage,
});

const CATEGORIAS = ["Restauração","Endodontia","Periodontia","Cirurgia","Prótese","Ortodontia","Estética","Prevenção","Outros"];
const CORES = ["#0d9488","#0891b2","#0284c7","#7c3aed","#db2777","#dc2626","#ea580c","#ca8a04","#16a34a","#475569"];

function ProcedimentosCatalogoPage() {
  const [items, setItems] = useState<ProcedimentoCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ProcedimentoCatalogo | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await procedimentosCatalogoApi.list();
      const data = ((res as any).data || res || []) as ProcedimentoCatalogo[];
      setItems(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const novo = () => {
    setEditing({
      id: "", codigo: null, nome: "", categoria: "Restauração",
      valor_particular: 0, valor_convenio: 0, duracao_minutos: 30,
      cor: CORES[0], requer_dente: true, requer_face: false,
      ativo: true, descricao: null,
    });
    setOpen(true);
  };

  const editar = (p: ProcedimentoCatalogo) => { setEditing({ ...p }); setOpen(true); };

  const salvar = async () => {
    if (!editing) return;
    if (!editing.nome.trim()) { toast.error("Nome obrigatório"); return; }
    const body = { ...editing };
    const res = editing.id
      ? await procedimentosCatalogoApi.update(editing.id, body)
      : await procedimentosCatalogoApi.create(body);
    if ((res as any).error) { toast.error((res as any).error); return; }
    toast.success(editing.id ? "Procedimento atualizado" : "Procedimento criado");
    setOpen(false); setEditing(null);
    load();
  };

  const excluir = async (id: string) => {
    if (!confirm("Inativar este procedimento?")) return;
    const res = await procedimentosCatalogoApi.delete(id);
    if ((res as any).error) { toast.error((res as any).error); return; }
    toast.success("Procedimento inativado");
    load();
  };

  const filtered = items.filter(p =>
    !search || p.nome.toLowerCase().includes(search.toLowerCase()) ||
    (p.codigo || "").toLowerCase().includes(search.toLowerCase())
  );

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Catálogo de Procedimentos" />
      <main className="flex-1 p-6 space-y-4 overflow-auto">
        <div className="flex items-center justify-between gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text" placeholder="Buscar..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button size="sm" onClick={novo} className="h-9 text-xs gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Novo procedimento
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 text-left">
                  <th className="px-3 py-2 font-semibold w-2"></th>
                  <th className="px-3 py-2 font-semibold">Nome</th>
                  <th className="px-3 py-2 font-semibold">Código</th>
                  <th className="px-3 py-2 font-semibold">Categoria</th>
                  <th className="px-3 py-2 font-semibold text-right">Particular</th>
                  <th className="px-3 py-2 font-semibold text-right">Convênio</th>
                  <th className="px-3 py-2 font-semibold text-center">Duração</th>
                  <th className="px-3 py-2 font-semibold text-center">Dente / Face</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2"><span className="block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.cor }} /></td>
                    <td className="px-3 py-2 font-medium text-foreground">{p.nome}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.codigo || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.categoria || '—'}</td>
                    <td className="px-3 py-2 text-right">{fmt(Number(p.valor_particular))}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{fmt(Number(p.valor_convenio))}</td>
                    <td className="px-3 py-2 text-center text-muted-foreground">{p.duracao_minutos} min</td>
                    <td className="px-3 py-2 text-center">
                      {p.requer_dente && <span className="px-1.5 py-0.5 mx-0.5 rounded bg-primary/10 text-primary text-[10px]">Dente</span>}
                      {p.requer_face && <span className="px-1.5 py-0.5 mx-0.5 rounded bg-accent/30 text-accent-foreground text-[10px]">Face</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => editar(p)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => excluir(p.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">Nenhum procedimento cadastrado</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Modal de edição */}
      {editing && (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle className="text-base">{editing.id ? "Editar procedimento" : "Novo procedimento"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Nome *</Label>
                <Input className="h-9 text-xs" value={editing.nome} onChange={e => setEditing({ ...editing, nome: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Código (TUSS, próprio…)</Label>
                <Input className="h-9 text-xs" value={editing.codigo || ""} onChange={e => setEditing({ ...editing, codigo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Categoria</Label>
                <select value={editing.categoria || ""} onChange={e => setEditing({ ...editing, categoria: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-background text-xs px-3">
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor particular (R$)</Label>
                <Input type="number" min={0} step="0.01" className="h-9 text-xs" value={editing.valor_particular}
                  onChange={e => setEditing({ ...editing, valor_particular: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor convênio (R$)</Label>
                <Input type="number" min={0} step="0.01" className="h-9 text-xs" value={editing.valor_convenio}
                  onChange={e => setEditing({ ...editing, valor_convenio: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Duração (min)</Label>
                <Input type="number" min={5} step="5" className="h-9 text-xs" value={editing.duracao_minutos}
                  onChange={e => setEditing({ ...editing, duracao_minutos: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cor</Label>
                <div className="flex gap-1.5">
                  {CORES.map(c => (
                    <button key={c} type="button" onClick={() => setEditing({ ...editing, cor: c })}
                      className={`w-6 h-6 rounded-full border-2 transition ${editing.cor === c ? "border-foreground scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <div className="col-span-2 flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={editing.requer_dente}
                    onChange={e => setEditing({ ...editing, requer_dente: e.target.checked })}
                    className="rounded accent-primary" />
                  Requer indicação de dente
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={editing.requer_face}
                    onChange={e => setEditing({ ...editing, requer_face: e.target.checked })}
                    className="rounded accent-primary" />
                  Requer face (V/L/M/D/O)
                </label>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Textarea rows={2} className="text-xs" value={editing.descricao || ""}
                  onChange={e => setEditing({ ...editing, descricao: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-9 text-xs">Cancelar</Button>
              <Button size="sm" onClick={salvar} className="h-9 text-xs">Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
