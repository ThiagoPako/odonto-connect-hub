import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Search, Plus, AlertTriangle, Package, ArrowDownCircle, ArrowUpCircle,
  Loader2, X,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  inventoryCategories,
  type InventoryItem, type StockMovement,
} from "@/data/estoqueMockData";
import { estoqueApi, vpsApiFetch } from "@/lib/vpsApi";

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
    minStock: Number(r.quantidade_minima) || 5,
    maxStock: Number(r.quantidade_maxima) || 50,
    unitCost: Number(r.valor_unitario) || 0,
    supplier: r.fornecedor || '',
    lastEntry: r.updated_at ? new Date(r.updated_at).toLocaleDateString("pt-BR") : '',
    expirationDate: r.validade || undefined,
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
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddMov, setShowAddMov] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [itemsRes, movsRes] = await Promise.all([
        estoqueApi.list(),
        vpsApiFetch('/estoque-movimentos'),
      ]);
      const itemsData = (itemsRes as any).data || itemsRes || [];
      const movsData = (movsRes as any).data || movsRes || [];
      setItems(Array.isArray(itemsData) ? itemsData.map(mapItem) : []);
      setMovements(Array.isArray(movsData) ? movsData.map(mapMovement) : []);
    } catch (err) {
      console.error('Erro ao carregar estoque:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filteredItems = items
    .filter((i) => categoryFilter === "all" || i.category === categoryFilter)
    .filter((i) => !searchTerm || i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const lowStock = items.filter((i) => i.currentStock <= i.minStock);
  const outOfStock = items.filter((i) => i.currentStock === 0);
  const totalValue = items.reduce((a, i) => a + i.currentStock * i.unitCost, 0);

  const handleAddItem = async (data: { nome: string; categoria: string; unidade: string; quantidade: number; quantidade_minima: number; valor_unitario: number; fornecedor: string; validade?: string }) => {
    try {
      await estoqueApi.create(data);
      await loadAll();
      setShowAddItem(false);
    } catch (err) { console.error('Erro ao adicionar item:', err); }
  };

  const handleAddMovement = async (data: { item_id: string; tipo: string; quantidade: number; motivo: string; usuario_nome: string }) => {
    try {
      await estoqueApi.addMovimento(data.item_id, {
        tipo: data.tipo, quantidade: data.quantidade,
        motivo: data.motivo, usuario_nome: data.usuario_nome,
      });
      await loadAll();
      setShowAddMov(false);
    } catch (err) { console.error('Erro ao registrar movimentação:', err); }
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
      <main className="flex-1 p-6 space-y-5 overflow-auto">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-slide-up" style={{ animationFillMode: 'both' }}>
          <KpiMini icon={Package} label="Itens Cadastrados" value={items.length.toString()} />
          <KpiMini icon={AlertTriangle} label="Estoque Baixo" value={lowStock.length.toString()} alert={lowStock.length > 0} />
          <KpiMini icon={AlertTriangle} label="Sem Estoque" value={outOfStock.length.toString()} alert={outOfStock.length > 0} />
          <KpiMini icon={Package} label="Valor Total" value={`R$ ${(totalValue / 1000).toFixed(1)}k`} />
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

        <Tabs defaultValue="inventory" className="space-y-4">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="inventory">Inventário</TabsTrigger>
              <TabsTrigger value="movements">Movimentações</TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <button onClick={() => setShowAddMov(true)} className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-muted/80">
                <ArrowDownCircle className="h-3.5 w-3.5" /> Registrar Mov.
              </button>
              <button onClick={() => setShowAddItem(true)} className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                <Plus className="h-3.5 w-3.5" /> Novo Item
              </button>
            </div>
          </div>

          <TabsContent value="inventory">
            {/* Filters */}
            <div className="flex items-center gap-2 mb-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input type="text" placeholder="Buscar item..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48" />
              </div>
              <div className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5">
                <button onClick={() => setCategoryFilter("all")} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${categoryFilter === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  Todos
                </button>
                {inventoryCategories.map((c) => (
                  <button key={c.id} onClick={() => setCategoryFilter(c.id)} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${categoryFilter === c.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Item</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Categoria</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Estoque</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Mín</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Custo Unit.</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Fornecedor</th>
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Última Atualiz.</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {item.currentStock <= item.minStock && <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />}
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
                      <td className="px-4 py-3 text-right text-xs text-foreground">R$ {item.unitCost.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{item.supplier}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{item.lastEntry}</td>
                    </tr>
                  ))}
                  {filteredItems.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhum item encontrado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="movements">
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full">
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
        {showAddItem && <AddItemModal onSave={handleAddItem} onClose={() => setShowAddItem(false)} />}

        {/* Modal: Registrar Movimentação */}
        {showAddMov && <AddMovementModal items={items} onSave={handleAddMovement} onClose={() => setShowAddMov(false)} />}
      </main>
    </div>
  );
}

function AddItemModal({ onSave, onClose }: { onSave: (d: any) => void; onClose: () => void }) {
  const [form, setForm] = useState({ nome: '', categoria: 'material', unidade: 'un', quantidade: '', quantidade_minima: '5', valor_unitario: '', fornecedor: '', validade: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome) return;
    setSaving(true);
    await onSave({ ...form, quantidade: Number(form.quantidade) || 0, quantidade_minima: Number(form.quantidade_minima) || 5, valor_unitario: Number(form.valor_unitario) || 0, validade: form.validade || null });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-lg mx-4 animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h2 className="text-lg font-bold text-foreground font-heading">Novo Item de Estoque</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome do Item</label>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Categoria</label>
              <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                {inventoryCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Unidade</label>
              <input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantidade Inicial</label>
              <input type="number" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Estoque Mínimo</label>
              <input type="number" value={form.quantidade_minima} onChange={(e) => setForm({ ...form, quantidade_minima: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Custo Unitário (R$)</label>
              <input type="number" value={form.valor_unitario} onChange={(e) => setForm({ ...form, valor_unitario: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Fornecedor</label>
              <input value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/60">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Cadastrar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddMovementModal({ items, onSave, onClose }: { items: InventoryItem[]; onSave: (d: any) => void; onClose: () => void }) {
  const [form, setForm] = useState({ item_id: items[0]?.id ?? '', tipo: 'entrada', quantidade: '', motivo: '', usuario_nome: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.item_id || !form.quantidade) return;
    setSaving(true);
    await onSave({ ...form, quantidade: Number(form.quantidade) });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-md mx-4 animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h2 className="text-lg font-bold text-foreground font-heading">Registrar Movimentação</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Item</label>
            <select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}
              className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
                <option value="ajuste">Ajuste</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantidade</label>
              <input type="number" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} required min={1}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Motivo</label>
            <input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="Ex: Compra fornecedor"
              className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Responsável</label>
            <input value={form.usuario_nome} onChange={(e) => setForm({ ...form, usuario_nome: e.target.value })} placeholder="Nome do usuário"
              className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/60">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Registrar
            </button>
          </div>
        </form>
      </div>
    </div>
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
