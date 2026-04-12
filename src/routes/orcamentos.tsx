import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Plus, Search, DollarSign, CheckCircle2, XCircle, Clock, TrendingUp,
  FileText, CreditCard, ExternalLink, Loader2,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { orcamentosApi } from "@/lib/vpsApi";
import { toast } from "sonner";

export const Route = createFileRoute("/orcamentos")({
  ssr: false,
  component: OrcamentosPage,
});

interface OrcamentoRow {
  id: string;
  paciente_id: string;
  paciente_nome: string;
  dentista_nome: string;
  itens: any[];
  valor_total: number;
  desconto: number;
  status: string;
  forma_pagamento: string;
  parcelas: number;
  observacoes: string;
  created_at: string;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  pendente: { label: "Pendente", color: "bg-warning/15 text-warning" },
  aprovado: { label: "Aprovado", color: "bg-success/15 text-success" },
  reprovado: { label: "Reprovado", color: "bg-destructive/15 text-destructive" },
  em_tratamento: { label: "Em Tratamento", color: "bg-primary/15 text-primary" },
  finalizado: { label: "Finalizado", color: "bg-muted text-muted-foreground" },
};

function getInitials(name: string) {
  return name.split(" ").filter((_, i, a) => i === 0 || i === a.length - 1).map(n => n[0]).join("").toUpperCase();
}

const AVATAR_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"];

function mapOrcamento(r: any): OrcamentoRow {
  let itens = r.itens || [];
  if (typeof itens === 'string') try { itens = JSON.parse(itens); } catch { itens = []; }
  return {
    id: r.id,
    paciente_id: r.paciente_id || '',
    paciente_nome: r.paciente_nome || r.paciente_id || '',
    dentista_nome: r.dentista_nome || '',
    itens: Array.isArray(itens) ? itens : [],
    valor_total: Number(r.valor_total) || 0,
    desconto: Number(r.desconto) || 0,
    status: r.status || 'pendente',
    forma_pagamento: r.forma_pagamento || '',
    parcelas: Number(r.parcelas) || 1,
    observacoes: r.observacoes || '',
    created_at: r.created_at ? new Date(r.created_at).toLocaleDateString("pt-BR") : '',
  };
}

function OrcamentosPage() {
  const [orcamentos, setOrcamentos] = useState<OrcamentoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const res = await orcamentosApi.list();
      const data = (res as any).data || res || [];
      setOrcamentos(Array.isArray(data) ? data.map(mapOrcamento) : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = orcamentos
    .filter(b => filterStatus === "all" || b.status === filterStatus)
    .filter(b => !searchTerm || b.paciente_nome.toLowerCase().includes(searchTerm.toLowerCase()));

  const totalPending = orcamentos.filter(b => b.status === "pendente").reduce((a, b) => a + (b.valor_total - b.desconto), 0);
  const totalApproved = orcamentos.filter(b => ["aprovado", "em_tratamento"].includes(b.status)).reduce((a, b) => a + (b.valor_total - b.desconto), 0);
  const conversionRate = orcamentos.length > 0
    ? ((orcamentos.filter(b => ["aprovado", "em_tratamento", "finalizado"].includes(b.status)).length / orcamentos.length) * 100).toFixed(0) : "0";

  const selected = orcamentos.find(o => o.id === selectedId) || null;

  const handleStatusChange = async (id: string, newStatus: string) => {
    const { data, error } = await orcamentosApi.updateStatus(id, newStatus);
    if (error) { toast.error("Erro: " + error); return; }
    const label = newStatus === 'aprovado' ? 'aprovado ✅' : newStatus === 'reprovado' ? 'reprovado ❌' : newStatus;
    toast.success(`Orçamento ${label}`);
    if ((data as any)?.leadMoved) {
      const dest = newStatus === 'reprovado' ? 'Recuperação de Vendas' : 'Orçamento Aprovado';
      toast.info(`Lead movido automaticamente para "${dest}" no CRM`);
    }
    loadAll();
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Orçamentos e Vendas" />
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Orçamentos e Vendas" />
      <main className="flex-1 p-6 space-y-5 overflow-auto">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-slide-up" style={{ animationFillMode: 'both' }}>
          <KpiMini icon={FileText} label="Total Orçamentos" value={orcamentos.length.toString()} />
          <KpiMini icon={Clock} label="Valor Pendente" value={`R$ ${(totalPending / 1000).toFixed(1)}k`} />
          <KpiMini icon={DollarSign} label="Valor Aprovado" value={`R$ ${(totalApproved / 1000).toFixed(1)}k`} />
          <KpiMini icon={TrendingUp} label="Taxa Conversão" value={`${conversionRate}%`} />
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input type="text" placeholder="Buscar paciente..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48" />
            </div>
            <div className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5 text-sm">
              {[{ id: "all", label: "Todos" }, { id: "pendente", label: "Pendentes" }, { id: "aprovado", label: "Aprovados" }, { id: "reprovado", label: "Reprovados" }].map(f => (
                <button key={f.id} onClick={() => setFilterStatus(f.id)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filterStatus === f.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Budget list */}
          <div className="lg:col-span-1 space-y-2">
            {filtered.map((b, i) => {
              const cfg = statusConfig[b.status] || statusConfig.pendente;
              const finalValue = b.valor_total - b.desconto;
              return (
                <div key={b.id} onClick={() => setSelectedId(b.id)}
                  className={`bg-card rounded-xl border p-4 cursor-pointer transition-all duration-300 hover-lift ${selectedId === b.id ? "border-primary ring-1 ring-primary/20 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.3)]" : "border-border hover:border-primary/40 hover:shadow-glow-primary"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-7 w-7 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-[9px] font-bold text-white`}>
                        {getInitials(b.paciente_nome)}
                      </div>
                      <span className="text-xs font-medium text-foreground">{b.paciente_nome}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{b.itens.length} itens · {b.created_at}</span>
                    <span className="text-sm font-bold text-foreground">R$ {finalValue.toLocaleString("pt-BR")}</span>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">Nenhum orçamento encontrado</p>}
          </div>

          {/* Budget detail */}
          <div className="lg:col-span-2">
            {selected ? (
              <BudgetDetail budget={selected} onStatusChange={handleStatusChange} />
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um orçamento</h3>
                <p className="text-xs text-muted-foreground">Clique em um orçamento para ver os detalhes.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function KpiMini({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="group bg-card rounded-xl border border-border p-4 space-y-1 hover-lift hover:shadow-glow-primary transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
      <div className="flex items-center gap-2 text-muted-foreground relative z-10">
        <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center group-hover:shadow-[0_0_10px_-2px_hsl(var(--primary)/0.3)] transition-shadow duration-300">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground relative z-10">{value}</p>
    </div>
  );
}

function BudgetDetail({ budget: b, onStatusChange }: { budget: OrcamentoRow; onStatusChange: (id: string, status: string) => void }) {
  const cfg = statusConfig[b.status] || statusConfig.pendente;
  const [updating, setUpdating] = useState(false);
  const finalValue = b.valor_total - b.desconto;

  const handleChange = async (newStatus: string) => {
    setUpdating(true);
    await onStatusChange(b.id, newStatus);
    setUpdating(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">{b.paciente_nome}</h3>
            <p className="text-xs text-muted-foreground">{b.dentista_nome || 'Sem dentista'} · Criado em {b.created_at}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
        </div>

        {/* Items table */}
        {b.itens.length > 0 && (
          <table className="w-full mb-4">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase">Procedimento</th>
                <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-center">Dente</th>
                <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-center">Qtd</th>
                <th className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {b.itens.map((item: any, i: number) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="py-2 text-xs text-foreground">{item.procedimento || item.procedure || item.descricao || '-'}</td>
                  <td className="py-2 text-xs text-muted-foreground text-center">{item.dente || item.tooth || "—"}</td>
                  <td className="py-2 text-xs text-foreground text-center">{item.quantidade || item.quantity || 1}</td>
                  <td className="py-2 text-xs font-medium text-foreground text-right">R$ {Number(item.valor || item.totalPrice || 0).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Totals */}
        <div className="space-y-1.5 border-t border-border pt-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Subtotal</span>
            <span>R$ {b.valor_total.toLocaleString("pt-BR")}</span>
          </div>
          {b.desconto > 0 && (
            <div className="flex justify-between text-xs text-success">
              <span>Desconto</span>
              <span>- R$ {b.desconto.toLocaleString("pt-BR")}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-foreground pt-1">
            <span>Total</span>
            <span>R$ {finalValue.toLocaleString("pt-BR")}</span>
          </div>
        </div>
      </div>

      {/* Payment & actions */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-card-foreground mb-3">Pagamento</h4>
        {b.forma_pagamento ? (
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-foreground">{b.forma_pagamento}</p>
              {b.parcelas > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  {b.parcelas}x de R$ {(finalValue / b.parcelas).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Pagamento não definido</p>
        )}

        {b.status === "pendente" && (
          <div className="flex items-center gap-2 mt-4">
            <button disabled={updating} onClick={() => handleChange("aprovado")}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-success text-white text-xs font-medium hover:bg-success/90 disabled:opacity-50">
              {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Aprovar
            </button>
            <button disabled={updating} onClick={() => handleChange("reprovado")}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-destructive text-white text-xs font-medium hover:bg-destructive/90 disabled:opacity-50">
              {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Reprovar
            </button>
          </div>
        )}

        {b.status === "reprovado" && (
          <div className="mt-3 p-2 rounded-lg bg-destructive/10 text-destructive text-xs">
            ❌ Orçamento reprovado — lead movido para Recuperação de Vendas no CRM
          </div>
        )}
        {b.status === "aprovado" && (
          <div className="mt-3 p-2 rounded-lg bg-success/10 text-success text-xs">
            ✅ Orçamento aprovado — lead movido para Orçamento Aprovado no CRM
          </div>
        )}
      </div>
    </div>
  );
}
