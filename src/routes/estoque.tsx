import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Search, Plus, AlertTriangle, Package, ArrowDownCircle, ArrowUpCircle,
  Wrench, Filter,
} from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  mockInventory, mockMovements, inventoryCategories,
  type InventoryItem, type StockMovement,
} from "@/data/estoqueMockData";

export const Route = createFileRoute("/estoque")({
  ssr: false,
  component: EstoquePage,
});

function EstoquePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filteredItems = mockInventory
    .filter((i) => categoryFilter === "all" || i.category === categoryFilter)
    .filter((i) => !searchTerm || i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const lowStock = mockInventory.filter((i) => i.currentStock <= i.minStock);
  const outOfStock = mockInventory.filter((i) => i.currentStock === 0);
  const totalValue = mockInventory.reduce((a, i) => a + i.currentStock * i.unitCost, 0);

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Controle de Estoque" />
      <main className="flex-1 p-6 space-y-5 overflow-auto">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiMini icon={Package} label="Itens Cadastrados" value={mockInventory.length.toString()} />
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
            <button className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5" /> Novo Item
            </button>
          </div>

          <TabsContent value="inventory">
            {/* Filters */}
            <div className="flex items-center gap-2 mb-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar item..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
                />
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
                    <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Última Entrada</th>
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
                        <span className="text-xs text-muted-foreground">{inventoryCategories.find((c) => c.id === item.category)?.label}</span>
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
                  {mockMovements.map((m) => (
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
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function KpiMini({ icon: Icon, label, value, alert }: { icon: React.ElementType; label: string; value: string; alert?: boolean }) {
  return (
    <div className={`bg-card rounded-xl border p-4 space-y-1 ${alert ? "border-warning/50" : "border-border"}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={`h-4 w-4 ${alert ? "text-warning" : ""}`} />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className={`text-lg font-bold ${alert ? "text-warning" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
