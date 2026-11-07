/**
 * Catálogo de Procedimentos — Fase B/C
 * CRUD completo dos procedimentos que serão usados em orçamentos e execuções.
 */
import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Archive, Loader2, History } from "lucide-react";
import { BarraFiltros } from "@/components/filtros/BarraFiltros";
import { useFiltroUrl } from "@/components/filtros/useFiltroUrl";
import { procedimentosCatalogoApi, type ProcedimentoCatalogo } from "@/lib/vpsApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { HistoricoVersoesModal } from "@/components/procedimentos/HistoricoVersoesModal";

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
  const [categoriaUrl, setCategoria] = useFiltroUrl("categoria");
  const [editing, setEditing] = useState<ProcedimentoCatalogo | null>(null);
  const [open, setOpen] = useState(false);
  const [motivoVersao, setMotivoVersao] = useState("");
  const [historicoId, setHistoricoId] = useState<string | null>(null);
  const [historicoNome, setHistoricoNome] = useState<string>("");

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await procedimentosCatalogoApi.list();
    setLoadError(res.error);
    if (res.error) toast.error("Não foi possível carregar os procedimentos: " + res.error);
    else setItems(Array.isArray(res.data) ? (res.data as ProcedimentoCatalogo[]) : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const novo = () => {
    setEditing({
      id: "", codigo: null, nome: "", categoria: "Restauração",
      valor_particular: 0, valor_convenio: 0, duracao_minutos: 30,
      cor: CORES[0], requer_dente: true, requer_face: false,
      ativo: true, descricao: null,
    });
    setMotivoVersao("");
    setOpen(true);
  };

  const editar = (p: ProcedimentoCatalogo) => { setEditing({ ...p }); setMotivoVersao(""); setOpen(true); };

  const salvar = async () => {
    if (!editing || saving) return;
    if (!editing.nome.trim()) { toast.error("Informe o nome do procedimento."); return; }
    if (!(Number(editing.valor_particular) >= 0) || !(Number(editing.valor_convenio) >= 0)) {
      toast.error("Os valores não podem ser negativos."); return;
    }
    if (!(Number(editing.duracao_minutos) > 0)) { toast.error("A duração precisa ser maior que zero."); return; }
    setSaving(true);
    const body: any = { ...editing };
    if (editing.id && motivoVersao.trim()) body.motivo_versao = motivoVersao.trim();
    const res = editing.id
      ? await procedimentosCatalogoApi.update(editing.id, body)
      : await procedimentosCatalogoApi.create(body);
    setSaving(false);
    // Clique duplo em "Salvar" criava dois procedimentos iguais
    if ((res as any).error) { toast.error("Erro ao salvar: " + (res as any).error); return; }
    const novaVersao = (res as any).data?._nova_versao || (res as any)._nova_versao;
    toast.success(
      editing.id
        ? novaVersao ? `Procedimento atualizado — versão v${novaVersao.versao} criada` : "Procedimento atualizado"
        : "Procedimento criado"
    );
    setOpen(false); setEditing(null); setMotivoVersao("");
    load();
  };

  const excluir = async (id: string) => {
    if (!confirm("Inativar este procedimento?")) return;
    const res = await procedimentosCatalogoApi.delete(id);
    if ((res as any).error) { toast.error((res as any).error); return; }
    toast.success("Procedimento inativado");
    load();
  };

  const termo = search.trim().toLowerCase();
  const categorias = [...new Set(items.map(p => p.categoria).filter(Boolean))].sort() as string[];
  // Valor da URL que não existe nas opções atuais (link antigo, item apagado) é ignorado: nada de filtro invisível.
  const categoria = categorias.includes(categoriaUrl) ? categoriaUrl : "";
  const filtered = items.filter(p =>
    (!categoria || p.categoria === categoria) &&
    (!termo || (p.nome || "").toLowerCase().includes(termo) || (p.codigo || "").toLowerCase().includes(termo))
  );
  const vazioMsg = items.length === 0 ? "Nenhum procedimento cadastrado" : "Nenhum procedimento encontrado com essa busca ou filtro";

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Catálogo de Procedimentos" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-auto">
        <BarraFiltros
          busca={{ valor: search, onChange: setSearch, placeholder: "Nome ou código", rotulo: "Buscar procedimento por nome ou código" }}
          filtros={categorias.length > 0 ? [{
            id: "categoria",
            rotulo: "Categoria",
            valor: categoria,
            onChange: setCategoria,
            rotuloTodos: "Todas",
            opcoes: categorias.map(c => ({ valor: c, rotulo: c })),
          }] : []}
          onLimpar={() => { setSearch(""); setCategoria(""); }}
          resultado={`${filtered.length} procedimento${filtered.length !== 1 ? "s" : ""}`}
          acoes={
            <Button onClick={novo} className="h-10 gap-1.5">
              <Plus className="h-4 w-4" /> Novo procedimento
            </Button>
          }
        />

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
          {/* Celular: cartões */}
          <ul className="lg:hidden space-y-2">
            {filtered.map(p => (
              <li key={p.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <span className="mt-1 block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.cor }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground break-words">{p.nome}</p>
                    <p className="text-xs text-muted-foreground break-words">
                      {[p.codigo, p.categoria, `${p.duracao_minutos} min`, `v${p.versao_atual ?? 1}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Particular</dt><dd className="text-right text-foreground">{fmt(Number(p.valor_particular))}</dd>
                  <dt className="text-muted-foreground">Convênio</dt><dd className="text-right text-foreground">{fmt(Number(p.valor_convenio))}</dd>
                </dl>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-1">
                    {p.requer_dente && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]">Dente</span>}
                    {p.requer_face && <span className="px-1.5 py-0.5 rounded bg-accent/30 text-accent-foreground text-[10px]">Face</span>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setHistoricoId(p.id); setHistoricoNome(p.nome); }} aria-label="Ver histórico de versões" className="h-9 w-9 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-primary"><History className="h-4 w-4" /></button>
                    <button onClick={() => editar(p)} aria-label="Editar procedimento" className="h-9 w-9 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => excluir(p.id)} aria-label="Inativar procedimento" className="h-9 w-9 inline-flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Archive className="h-4 w-4" /></button>
                  </div>
                </div>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="py-12 text-center text-xs text-muted-foreground">
                {loadError ? (
                  <span role="alert" className="text-destructive">
                    Não foi possível carregar os procedimentos. {loadError}{" "}
                    <button type="button" onClick={load} className="underline font-semibold">Tentar de novo</button>
                  </span>
                ) : vazioMsg}
              </li>
            )}
          </ul>
          <div className="hidden lg:block bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full min-w-[860px] text-xs">
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
                  <th className="px-3 py-2 font-semibold text-center">Versão</th>
                  <th className="px-3 py-2 w-28"></th>
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
                    <td className="px-3 py-2 text-center">
                      <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-mono">
                        v{p.versao_atual ?? 1}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => { setHistoricoId(p.id); setHistoricoNome(p.nome); }}
                          title="Ver histórico de versões"
                          aria-label="Ver histórico de versões"
                          className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-primary"
                        >
                          <History className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => editar(p)} title="Editar" aria-label="Editar procedimento" className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => excluir(p.id)} title="Inativar (sai da lista)" aria-label="Inativar procedimento" className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Archive className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                    {loadError ? (
                      <span role="alert" className="text-destructive">
                        Não foi possível carregar os procedimentos. {loadError}{" "}
                        <button type="button" onClick={load} className="underline font-semibold">Tentar de novo</button>
                      </span>
                    ) : vazioMsg}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Modal de edição */}
      {editing && (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-base">{editing.id ? "Editar procedimento" : "Novo procedimento"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
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
              <div className="sm:col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
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
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Textarea rows={2} className="text-xs" value={editing.descricao || ""}
                  onChange={e => setEditing({ ...editing, descricao: e.target.value })} />
              </div>
              {editing.id && (
                <div className="sm:col-span-2 space-y-1.5 border-t border-border pt-3">
                  <Label className="text-xs flex items-center gap-1.5">
                    <History className="h-3 w-3 text-primary" />
                    Motivo da alteração <span className="text-muted-foreground font-normal">(opcional — descreve esta versão)</span>
                  </Label>
                  <Input
                    className="h-9 text-xs"
                    placeholder="ex: reajuste anual, correção de requisitos, mudança de categoria…"
                    value={motivoVersao}
                    onChange={e => setMotivoVersao(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Alterações em preço, nome, categoria, requisitos ou duração geram uma nova versão automaticamente.
                    Orçamentos antigos continuam usando a versão original.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-9 text-xs">Cancelar</Button>
              <Button size="sm" onClick={salvar} disabled={saving} className="h-9 text-xs">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <HistoricoVersoesModal
        open={!!historicoId}
        onOpenChange={(v) => { if (!v) { setHistoricoId(null); setHistoricoNome(""); } }}
        procedimentoId={historicoId}
        procedimentoNome={historicoNome}
      />
    </div>
  );
}
