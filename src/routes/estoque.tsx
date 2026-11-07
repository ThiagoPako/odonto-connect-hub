import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { EstadoVazio } from "@/components/EstadoVazio";
import {
  Plus, AlertTriangle, Package, ArrowDownCircle, ArrowUpCircle,
  Loader2, Pencil, Trash2, CalendarClock,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { BarraFiltros } from "@/components/filtros/BarraFiltros";
import { useFiltroUrl } from "@/components/filtros/useFiltroUrl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  inventoryCategories,
  type InventoryItem, type StockMovement,
} from "@/data/estoqueMockData";
import { estoqueApi, vpsApiFetch } from "@/lib/vpsApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { formatBRL, parseValorBRL, maskValorDigitado, isoParaBr } from "@/lib/formatos";
import { localDateISO } from "@/lib/utils";

export const Route = createFileRoute("/estoque")({
  ssr: false,
  component: EstoquePage,
});

function mapItem(r: any): InventoryItem {
  return {
    id: r.id,
    name: r.nome || '',
    category: r.categoria || 'material',
    unit: r.unidade || 'un',
    currentStock: Number(r.quantidade) || 0,
    minStock: r.quantidade_minima != null && r.quantidade_minima !== "" ? Number(r.quantidade_minima) || 0 : 5,
    maxStock: Number(r.quantidade_maxima) || 50,
    unitCost: Number(r.valor_unitario) || 0,
    supplier: r.fornecedor || '',
    lastEntry: r.updated_at ? new Date(r.updated_at).toLocaleDateString("pt-BR") : '',
    // validade é DATE: o servidor devolve "aaaa-mm-dd" ou ISO com hora; guardamos só aaaa-mm-dd
    expirationDate: r.validade ? String(r.validade).slice(0, 10) : undefined,
  };
}

function mapMovement(r: any): StockMovement {
  return {
    id: r.id,
    itemId: r.item_id || '',
    itemName: r.item_nome || r.nome || '',
    type: r.tipo || 'entrada',
    quantity: Number(r.quantidade) || 0,
    date: r.created_at ? new Date(r.created_at).toLocaleDateString("pt-BR") : '',
    reason: r.motivo || '',
    user: r.usuario_nome || '',
  };
}

function EstoquePage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useFiltroUrl("categoria", inventoryCategories.map((c) => c.id));
  const [situacaoFilter, setSituacaoFilter] = useFiltroUrl("situacao", ["baixo", "zerado", "ok"]);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddMov, setShowAddMov] = useState(false);
  const [movItemId, setMovItemId] = useState<string | undefined>(undefined);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const loadAll = useCallback(async () => {
    const [itemsRes, movsRes] = await Promise.all([
      estoqueApi.list(),
      vpsApiFetch<any[]>('/estoque-movimentos'),
    ]);
    // vpsApiFetch não lança: a parte que falhar vira aviso e mantém o que já estava na tela
    const errors: string[] = [];
    if (itemsRes.error) errors.push(`Itens: ${itemsRes.error}`);
    else setItems(Array.isArray(itemsRes.data) ? itemsRes.data.map(mapItem) : []);
    if (movsRes.error) errors.push(`Movimentações: ${movsRes.error}`);
    else setMovements(Array.isArray(movsRes.data) ? movsRes.data.map(mapMovement) : []);
    setLoadErrors(errors);
    if (errors.length) toast.error("Parte do estoque não carregou.");
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filteredItems = items
    .filter((i) => !categoryFilter || i.category === categoryFilter)
    .filter((i) =>
      !situacaoFilter ||
      (situacaoFilter === "zerado" && i.currentStock === 0) ||
      (situacaoFilter === "baixo" && i.currentStock <= i.minStock) ||
      (situacaoFilter === "ok" && i.currentStock > i.minStock))
    .filter((i) => !searchTerm.trim() || (i.name || "").toLowerCase().includes(searchTerm.trim().toLowerCase()));

  const lowStock = items.filter((i) => i.currentStock <= i.minStock);
  // Vencidos ou vencendo em até 30 dias
  const hoje = localDateISO();
  const em30 = localDateISO(new Date(Date.now() + 30 * 86400000));
  const vencendo = items.filter((i) => i.expirationDate && i.expirationDate <= em30);
  const outOfStock = items.filter((i) => i.currentStock === 0);
  const totalValue = items.reduce((a, i) => a + i.currentStock * i.unitCost, 0);

  const handleAddItem = async (data: ItemPayload): Promise<boolean> => {
    if (editItem) {
      const { error } = await estoqueApi.update(editItem.id, data);
      if (error) { toast.error("Erro ao salvar item: " + error); return false; }
      toast.success("Item atualizado");
      setEditItem(null);
      await loadAll();
      return true;
    }
    const { data: created, error } = await estoqueApi.create(data);
    if (error) { toast.error("Erro ao cadastrar item: " + error); return false; }
    // O cadastro no servidor troca mínimo 0 por 5; a edição aceita 0, então gravamos o 0 logo depois.
    const createdId = (created as { id?: string } | null)?.id;
    if (data.quantidade_minima === 0 && createdId) {
      const { error: minError } = await estoqueApi.update(createdId, { quantidade_minima: 0 });
      if (minError) toast.error("Item cadastrado, mas o estoque mínimo ficou 5. Edite o item para zerar.");
      else toast.success("Item cadastrado");
    } else {
      toast.success("Item cadastrado");
    }
    setShowAddItem(false);
    await loadAll();
    return true;
  };

  const handleAddMovement = async (data: { item_id: string; tipo: string; quantidade: number; motivo: string; usuario_nome: string }): Promise<boolean> => {
    const { error } = await estoqueApi.addMovimento(data.item_id, {
      tipo: data.tipo, quantidade: data.quantidade,
      motivo: data.motivo, usuario_nome: data.usuario_nome,
    });
    if (error) { toast.error("Erro ao registrar movimentação: " + error); return false; }
    toast.success("Movimentação registrada");
    setShowAddMov(false);
    await loadAll();
    return true;
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    setDeleting(true);
    const { error } = await estoqueApi.delete(deleteItem.id);
    setDeleting(false);
    if (error) { toast.error("Erro ao excluir item: " + error); return; }
    toast.success(`"${deleteItem.name}" excluído`);
    setDeleteItem(null);
    await loadAll();
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Controle de Estoque" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Controle de Estoque" />
      <div className="flex-1 p-4 sm:p-6 space-y-5 overflow-auto">
        {loadErrors.length > 0 && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <div>
              <p className="font-semibold">Parte do estoque não carregou — saldos e alertas podem estar incompletos.</p>
              <ul className="mt-1 list-disc pl-5 text-xs">{loadErrors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
            <Button size="sm" variant="outline" onClick={loadAll}>Tentar de novo</Button>
          </div>
        )}
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-slide-up" style={{ animationFillMode: 'both' }}>
          <KpiMini icon={Package} label="Itens Cadastrados" value={items.length.toString()} />
          <KpiMini icon={AlertTriangle} label="Estoque Baixo" value={lowStock.length.toString()} alert={lowStock.length > 0} />
          <KpiMini icon={AlertTriangle} label="Sem Estoque" value={outOfStock.length.toString()} alert={outOfStock.length > 0} />
          <KpiMini icon={Package} label="Valor em estoque" value={formatBRL(totalValue)} />
        </div>

        {/* Alerts */}
        {lowStock.length > 0 && (
          <div className="bg-warning/10 border border-warning/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-xs font-semibold text-warning">Alertas de Estoque Baixo</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {lowStock.map((i) => (
                <span key={i.id} className="px-2.5 py-1 rounded-lg bg-background text-xs font-medium text-foreground border border-border">
                  {i.name}: <span className={`font-bold ${i.currentStock === 0 ? "text-destructive" : "text-warning"}`}>{i.currentStock}</span>/{i.minStock} min
                </span>
              ))}
            </div>
          </div>
        )}

        {vencendo.length > 0 && (
          <div className="bg-destructive/5 border border-destructive/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CalendarClock className="h-4 w-4 text-destructive" />
              <span className="text-xs font-semibold text-destructive">Validade: vencidos ou vencendo em 30 dias</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {vencendo.map((i) => (
                <span key={i.id} className="px-2.5 py-1 rounded-lg bg-background text-xs font-medium text-foreground border border-border">
                  {i.name}: <span className="font-bold text-destructive">{i.expirationDate! < hoje ? "venceu em " : "vence em "}{isoParaBr(i.expirationDate)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <Tabs defaultValue="inventory" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="inventory">Inventário</TabsTrigger>
              <TabsTrigger value="movements">Movimentações</TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setMovItemId(undefined); setShowAddMov(true); }} disabled={items.length === 0}
                title={items.length === 0 ? "Cadastre um item primeiro" : undefined}
                className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed">
                <ArrowDownCircle className="h-3.5 w-3.5" /> Entrada / saída
              </button>
              <button onClick={() => setShowAddItem(true)} className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                <Plus className="h-3.5 w-3.5" /> Novo Item
              </button>
            </div>
          </div>

          <TabsContent value="inventory">
            {/* Filtros */}
            <BarraFiltros
              className="mb-4"
              busca={{ valor: searchTerm, onChange: setSearchTerm, placeholder: "Buscar item" }}
              filtros={[
                {
                  id: "categoria",
                  rotulo: "Categoria",
                  valor: categoryFilter,
                  onChange: setCategoryFilter,
                  rotuloTodos: "Todas",
                  opcoes: inventoryCategories.map((c) => ({ valor: c.id, rotulo: c.label })),
                },
                {
                  id: "situacao",
                  rotulo: "Situação",
                  valor: situacaoFilter,
                  onChange: setSituacaoFilter,
                  opcoes: [
                    { valor: "baixo", rotulo: "Estoque baixo" },
                    { valor: "zerado", rotulo: "Sem estoque" },
                    { valor: "ok", rotulo: "Estoque normal" },
                  ],
                },
              ]}
              onLimpar={() => { setSearchTerm(""); setCategoryFilter(""); setSituacaoFilter(""); }}
              resultado={`${filteredItems.length} ${filteredItems.length !== 1 ? "itens" : "item"}`}
            />

            {/* Celular: cartões em vez de tabela */}
            <ul className="lg:hidden space-y-2">
              {filteredItems.map((item) => (
                <li key={item.id} className="bg-card rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground break-words flex items-center gap-1.5">
                        {item.currentStock <= item.minStock && <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" aria-label="Estoque baixo" />}
                        {item.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{inventoryCategories.find((c) => c.id === item.category)?.label || item.category}</p>
                    </div>
                    <p className="text-right shrink-0">
                      <span className={`text-base font-bold ${item.currentStock === 0 ? "text-destructive" : item.currentStock <= item.minStock ? "text-warning" : "text-foreground"}`}>{item.currentStock}</span>
                      <span className="text-[11px] text-muted-foreground ml-1">{item.unit}</span>
                      <span className="block text-[11px] text-muted-foreground">mínimo {item.minStock}</span>
                    </p>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Custo unitário</dt><dd className="text-foreground text-right">{formatBRL(item.unitCost)}</dd>
                    {item.supplier && (<><dt className="text-muted-foreground">Fornecedor</dt><dd className="text-foreground text-right break-words">{item.supplier}</dd></>)}
                    {item.expirationDate && (<><dt className="text-muted-foreground">Validade</dt><dd className={`text-right ${item.expirationDate <= em30 ? "text-destructive font-semibold" : "text-foreground"}`}>{isoParaBr(item.expirationDate)}</dd></>)}
                    {item.lastEntry && (<><dt className="text-muted-foreground">Atualizado em</dt><dd className="text-foreground text-right">{item.lastEntry}</dd></>)}
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => { setMovItemId(item.id); setShowAddMov(true); }}>Movimentar</Button>
                    <Button size="sm" variant="outline" className="h-9 text-xs gap-1.5" onClick={() => setEditItem(item)}><Pencil className="h-3.5 w-3.5" />Editar</Button>
                    <Button size="sm" variant="outline" className="h-9 text-xs gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleteItem(item)}><Trash2 className="h-3.5 w-3.5" />Excluir</Button>
                  </div>
                </li>
              ))}
              {filteredItems.length === 0 && (
                <li className="py-8 text-center text-xs text-muted-foreground">
                  {items.length === 0 && loadErrors.length === 0 ? (
                    <EstadoVazio
                      compacto
                      icon={Package}
                      titulo="Nenhum item no estoque"
                      descricao="Cadastre materiais, medicamentos e descartáveis com a quantidade mínima: o sistema avisa quando um item estiver acabando."
                      acao={{ label: "Novo item", icon: Plus, onClick: () => setShowAddItem(true) }}
                    />
                  ) : items.length === 0 ? "Nenhum item cadastrado." : "Nenhum item com esse filtro."}
                </li>
              )}
            </ul>

            {/* relative: o rótulo sr-only (absolute) da coluna Ações fica preso à rolagem da tabela */}
            <div className="relative hidden lg:block bg-card rounded-xl border border-border overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Item</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Categoria</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Estoque</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Mínimo</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Custo unitário</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Fornecedor</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Validade</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Atualizado em</th>
                    <th className="px-4 py-3"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {item.currentStock <= item.minStock && <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" aria-label="Estoque baixo" />}
                          <span className="text-sm font-medium text-foreground">{item.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">{inventoryCategories.find((c) => c.id === item.category)?.label || item.category}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-bold ${item.currentStock === 0 ? "text-destructive" : item.currentStock <= item.minStock ? "text-warning" : "text-foreground"}`}>
                          {item.currentStock}
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-1">{item.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-muted-foreground">{item.minStock}</td>
                      <td className="px-4 py-3 text-right text-xs text-foreground">{formatBRL(item.unitCost)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{item.supplier || "—"}</td>
                      <td className={`px-4 py-3 text-xs ${item.expirationDate && item.expirationDate <= em30 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                        {item.expirationDate ? isoParaBr(item.expirationDate) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{item.lastEntry}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { setMovItemId(item.id); setShowAddMov(true); }}>
                            Movimentar
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Editar ${item.name}`} onClick={() => setEditItem(item)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" aria-label={`Excluir ${item.name}`} onClick={() => setDeleteItem(item)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredItems.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-muted-foreground">
                      {items.length === 0 && loadErrors.length === 0 ? (
                        <EstadoVazio
                          compacto
                          icon={Package}
                          titulo="Nenhum item no estoque"
                          descricao="Cadastre materiais, medicamentos e descartáveis com a quantidade mínima: o sistema avisa quando um item estiver acabando."
                          acao={{ label: "Novo item", icon: Plus, onClick: () => setShowAddItem(true) }}
                        />
                      ) : "Nenhum item com esse filtro."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="movements">
            <div className="bg-card rounded-xl border border-border overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Tipo</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Item</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Qtd</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Motivo</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Usuário</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1 text-xs font-medium ${m.type === "entrada" ? "text-success" : m.type === "saida" ? "text-destructive" : "text-warning"}`}>
                          {m.type === "entrada" ? <ArrowDownCircle className="h-3.5 w-3.5" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
                          {m.type === "entrada" ? "Entrada" : m.type === "saida" ? "Saída" : "Ajuste"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">{m.itemName}</td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-foreground">{m.quantity}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{m.reason}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{m.user}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{m.date}</td>
                    </tr>
                  ))}
                  {movements.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma movimentação registrada</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>

        {/* Modal: Novo Item */}
        {(showAddItem || editItem) && (
          <AddItemModal item={editItem} onSave={handleAddItem} onClose={() => { setShowAddItem(false); setEditItem(null); }} />
        )}

        {/* Modal: Registrar Movimentação */}
        {showAddMov && <AddMovementModal items={items} initialItemId={movItemId} onSave={handleAddMovement} onClose={() => setShowAddMov(false)} />}

        <AlertDialog open={!!deleteItem} onOpenChange={(o) => { if (!o && !deleting) setDeleteItem(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir &ldquo;{deleteItem?.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                O item e todo o histórico de entradas e saídas dele serão apagados. Esta ação não pode ser desfeita.
                Se o item só acabou, prefira registrar a saída.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={(e) => { e.preventDefault(); handleDelete(); }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Excluir item
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

type ItemPayload = {
  nome: string; categoria: string; unidade: string; quantidade?: number; quantidade_minima: number;
  valor_unitario: number; fornecedor: string; validade: string | null;
};

const fieldCls = "w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-destructive";
const labelCls = "text-xs font-medium text-muted-foreground mb-1 block";

function ErroCampo({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return <p id={`${id}-erro`} className="mt-1 text-xs text-destructive">{msg}</p>;
}
const ariaErro = (id: string, erros: Record<string, string | undefined>) =>
  erros[id] ? { "aria-invalid": true as const, "aria-describedby": `${id}-erro` } : {};

/** Inteiro >= 0 (a coluna é integer). Devolve o número ou a mensagem de erro. */
function inteiro(text: string, rotulo: string, obrigatorio = false): number | string {
  if (!text.trim()) return obrigatorio ? `Informe ${rotulo}.` : 0;
  if (!/^\d+$/.test(text.trim())) return "Use um número inteiro, sem vírgula.";
  return Number(text);
}

function AddItemModal({ item, onSave, onClose }: { item: InventoryItem | null; onSave: (d: ItemPayload) => Promise<boolean>; onClose: () => void }) {
  const editando = !!item;
  const [form, setForm] = useState({
    nome: item?.name ?? "", categoria: item?.category ?? "material", unidade: item?.unit ?? "un",
    quantidade: "", quantidade_minima: String(item?.minStock ?? 5),
    valor_unitario: item ? String(item.unitCost).replace(".", ",") : "", fornecedor: item?.supplier ?? "",
    validade: item?.expirationDate ?? "",
  });
  const [erros, setErros] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string | undefined> = {};
    if (!form.nome.trim()) er["item-nome"] = "Informe o nome do item.";
    const qtd = editando ? 0 : inteiro(form.quantidade, "a quantidade");
    if (typeof qtd === "string") er["item-qtd"] = qtd;
    const min = inteiro(form.quantidade_minima, "o estoque mínimo");
    if (typeof min === "string") er["item-min"] = min;
    const custo = form.valor_unitario.trim() ? parseValorBRL(form.valor_unitario) : 0;
    if (custo === null || custo < 0) er["item-custo"] = "Valor inválido. Use o formato 1.234,56.";
    setErros(er);
    if (Object.keys(er).length || typeof qtd === "string" || typeof min === "string" || custo === null) return;
    setSaving(true);
    const payload: ItemPayload = {
      nome: form.nome.trim(), categoria: form.categoria, unidade: form.unidade.trim() || "un",
      quantidade_minima: min, valor_unitario: custo, fornecedor: form.fornecedor.trim(),
      validade: form.validade || null,
    };
    // Na edição a quantidade só muda por entrada/saída, para o histórico bater com o saldo.
    if (!editando) payload.quantidade = qtd;
    await onSave(payload);
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar item" : "Novo item de estoque"}</DialogTitle>
          {editando && (
            <DialogDescription>Para mudar a quantidade, use &ldquo;Movimentar&rdquo;: assim o histórico continua batendo com o saldo.</DialogDescription>
          )}
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="item-nome" className={labelCls}>Nome do item *</label>
              <input id="item-nome" autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex: Resina composta A2" className={fieldCls} {...ariaErro("item-nome", erros)} />
              <ErroCampo id="item-nome" msg={erros["item-nome"]} />
            </div>
            <div>
              <label htmlFor="item-cat" className={labelCls}>Categoria</label>
              <select id="item-cat" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value as InventoryItem["category"] })} className={fieldCls}>
                {inventoryCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="item-un" className={labelCls}>Unidade</label>
              <input id="item-un" value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                placeholder="un, caixa, seringa…" className={fieldCls} />
            </div>
            {!editando && (
              <div>
                <label htmlFor="item-qtd" className={labelCls}>Quantidade inicial</label>
                <input id="item-qtd" inputMode="numeric" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value.replace(/\D/g, "") })}
                  placeholder="0" className={fieldCls} {...ariaErro("item-qtd", erros)} />
                <ErroCampo id="item-qtd" msg={erros["item-qtd"]} />
              </div>
            )}
            <div>
              <label htmlFor="item-min" className={labelCls}>Estoque mínimo (alerta)</label>
              <input id="item-min" inputMode="numeric" value={form.quantidade_minima} onChange={(e) => setForm({ ...form, quantidade_minima: e.target.value.replace(/\D/g, "") })}
                className={fieldCls} {...ariaErro("item-min", erros)} />
              <ErroCampo id="item-min" msg={erros["item-min"]} />
            </div>
            <div>
              <label htmlFor="item-custo" className={labelCls}>Custo unitário (R$)</label>
              <input id="item-custo" inputMode="decimal" value={form.valor_unitario} onChange={(e) => setForm({ ...form, valor_unitario: maskValorDigitado(e.target.value) })}
                placeholder="0,00" className={fieldCls} {...ariaErro("item-custo", erros)} />
              <ErroCampo id="item-custo" msg={erros["item-custo"]} />
            </div>
            <div>
              <label htmlFor="item-forn" className={labelCls}>Fornecedor</label>
              <input id="item-forn" value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })} className={fieldCls} />
            </div>
            <div>
              <label htmlFor="item-val" className={labelCls}>Validade</label>
              <input id="item-val" type="date" value={form.validade} onChange={(e) => setForm({ ...form, validade: e.target.value })} className={fieldCls} />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type TipoMov = "entrada" | "saida" | "contagem";

function AddMovementModal({ items, initialItemId, onSave, onClose }: {
  items: InventoryItem[]; initialItemId?: string;
  onSave: (d: { item_id: string; tipo: string; quantidade: number; motivo: string; usuario_nome: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    item_id: initialItemId ?? items[0]?.id ?? "", tipo: "entrada" as TipoMov, quantidade: "", motivo: "",
    usuario_nome: user?.name ?? "",
  });
  const [erros, setErros] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const item = items.find((i) => i.id === form.item_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string | undefined> = {};
    if (!item) er["mov-item"] = "Escolha um item.";
    const n = inteiro(form.quantidade, form.tipo === "contagem" ? "a quantidade contada" : "a quantidade", true);
    if (typeof n === "string") er["mov-qtd"] = n;
    else if (form.tipo !== "contagem" && n === 0) er["mov-qtd"] = "A quantidade precisa ser maior que zero.";
    else if (form.tipo === "saida" && item && n > item.currentStock)
      er["mov-qtd"] = `Só há ${item.currentStock} ${item.unit} em estoque.`;
    else if (form.tipo === "contagem" && item && n === item.currentStock)
      er["mov-qtd"] = "A contagem é igual ao saldo atual: não há o que ajustar.";
    setErros(er);
    if (Object.keys(er).length || typeof n === "string" || !item) return;

    // O servidor só soma (entrada) ou subtrai (qualquer outro tipo). Por isso a contagem
    // vira entrada ou saída da diferença, com o motivo explicando o ajuste.
    let tipo: "entrada" | "saida" = form.tipo === "saida" ? "saida" : "entrada";
    let quantidade = n;
    let motivo = form.motivo.trim();
    if (form.tipo === "contagem") {
      const diff = n - item.currentStock;
      tipo = diff > 0 ? "entrada" : "saida";
      quantidade = Math.abs(diff);
      motivo = `Ajuste de contagem: ${item.currentStock} → ${n}${motivo ? ` (${motivo})` : ""}`;
    }
    setSaving(true);
    await onSave({ item_id: item.id, tipo, quantidade, motivo, usuario_nome: form.usuario_nome.trim() });
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar entrada ou saída</DialogTitle>
          <DialogDescription>O saldo do item é atualizado na hora.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="mov-item" className={labelCls}>Item *</label>
            <select id="mov-item" value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} className={fieldCls} {...ariaErro("mov-item", erros)}>
              {items.length === 0 && <option value="">Nenhum item cadastrado</option>}
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            {item && <p className="mt-1 text-xs text-muted-foreground">Saldo atual: <strong className="text-foreground">{item.currentStock} {item.unit}</strong></p>}
            <ErroCampo id="mov-item" msg={erros["mov-item"]} />
          </div>
          <fieldset>
            <legend className={labelCls}>Tipo</legend>
            <div className="grid grid-cols-3 gap-2">
              {([["entrada", "Entrada"], ["saida", "Saída"], ["contagem", "Contagem"]] as const).map(([v, l]) => (
                <label key={v} className={`flex h-10 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40 ${form.tipo === v ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:bg-muted/50"}`}>
                  <input type="radio" name="mov-tipo" value={v} checked={form.tipo === v} onChange={() => setForm({ ...form, tipo: v })} className="sr-only" />
                  {l}
                </label>
              ))}
            </div>
            {form.tipo === "contagem" && (
              <p className="mt-1 text-xs text-muted-foreground">Informe quanto há de fato na prateleira; o sistema lança a diferença.</p>
            )}
          </fieldset>
          <div>
            <label htmlFor="mov-qtd" className={labelCls}>{form.tipo === "contagem" ? "Quantidade contada *" : "Quantidade *"}</label>
            <input id="mov-qtd" inputMode="numeric" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value.replace(/\D/g, "") })}
              className={fieldCls} {...ariaErro("mov-qtd", erros)} />
            <ErroCampo id="mov-qtd" msg={erros["mov-qtd"]} />
          </div>
          <div>
            <label htmlFor="mov-motivo" className={labelCls}>Motivo</label>
            <input id="mov-motivo" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })}
              placeholder={form.tipo === "saida" ? "Ex: Uso em procedimento" : "Ex: Compra do fornecedor"} className={fieldCls} />
          </div>
          <div>
            <label htmlFor="mov-resp" className={labelCls}>Responsável</label>
            <input id="mov-resp" value={form.usuario_nome} onChange={(e) => setForm({ ...form, usuario_nome: e.target.value })}
              placeholder="Nome de quem registrou" className={fieldCls} />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? "Registrando…" : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KpiMini({ icon: Icon, label, value, alert }: { icon: React.ElementType; label: string; value: string; alert?: boolean }) {
  return (
    <div className={`group bg-card rounded-xl border p-4 space-y-1 hover-lift hover:shadow-glow-primary transition-all duration-300 relative overflow-hidden ${alert ? "border-warning/50" : "border-border"}`}>
      <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
      <div className="flex items-center gap-2 text-muted-foreground relative z-10">
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${alert ? "bg-warning/15" : "bg-primary/10"} group-hover:shadow-[0_0_10px_-2px_currentColor] transition-shadow duration-300`}>
          <Icon className={`h-3.5 w-3.5 ${alert ? "text-warning" : "text-primary"}`} />
        </div>
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className={`text-lg font-bold ${alert ? "text-warning" : "text-foreground"} relative z-10`}>{value}</p>
    </div>
  );
}
