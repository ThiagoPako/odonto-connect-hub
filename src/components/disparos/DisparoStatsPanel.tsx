import { X, Send, CheckCircle2, Eye, MessageSquare, AlertTriangle, TrendingUp, BarChart3 } from "lucide-react";
import { type DisparoProgramado } from "@/data/disparosMockData";
import {
  
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

interface DisparoStatsPanelProps {
  disparo: DisparoProgramado;
  onClose: () => void;
}

const COLORS = {
  enviadas: "hsl(var(--primary))",
  entregues: "hsl(var(--chart-2))",
  lidas: "hsl(var(--chart-3))",
  respondidas: "hsl(var(--chart-4))",
  erros: "hsl(var(--destructive))",
};

const PIE_COLORS = [
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground))",
];

export function DisparoStatsPanel({ disparo, onClose }: DisparoStatsPanelProps) {

  const { enviadas, entregues, lidas, respondidas, erros } = disparo.stats;
  const taxaEntrega = enviadas > 0 ? ((entregues / enviadas) * 100).toFixed(1) : "0";
  const taxaLeitura = enviadas > 0 ? ((lidas / enviadas) * 100).toFixed(1) : "0";
  const taxaResposta = enviadas > 0 ? ((respondidas / enviadas) * 100).toFixed(1) : "0";
  const taxaErro = enviadas > 0 ? ((erros / enviadas) * 100).toFixed(1) : "0";

  const pieData = [
    { name: "Entregues (não lidas)", value: Math.max(0, entregues - lidas) },
    { name: "Lidas (sem resposta)", value: Math.max(0, lidas - respondidas) },
    { name: "Respondidas", value: respondidas },
    { name: "Erros", value: erros },
    { name: "Não entregues", value: Math.max(0, enviadas - entregues) },
  ].filter((d) => d.value > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-[1000px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{disparo.nome}</h2>
              <p className="text-xs text-muted-foreground">Estatísticas detalhadas · Criado em {disparo.criadoEm}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatsKpi icon={Send} label="Enviadas" value={enviadas} color="text-primary" />
            <StatsKpi icon={CheckCircle2} label="Entregues" value={entregues} sub={`${taxaEntrega}%`} color="text-chart-2" />
            <StatsKpi icon={Eye} label="Lidas" value={lidas} sub={`${taxaLeitura}%`} color="text-chart-3" />
            <StatsKpi icon={MessageSquare} label="Respondidas" value={respondidas} sub={`${taxaResposta}%`} color="text-chart-4" />
            <StatsKpi icon={AlertTriangle} label="Erros" value={erros} sub={`${taxaErro}%`} color="text-destructive" />
          </div>

          {enviadas === 0 ? (
            <div className="bg-muted/50 rounded-xl p-12 flex flex-col items-center text-center">
              <TrendingUp className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Sem dados ainda</p>
              <p className="text-xs text-muted-foreground">As estatísticas aparecerão quando o disparo começar a enviar mensagens.</p>
            </div>
          ) : (
            <>
              {/* Os gráficos "Evolução dos envios" e "Distribuição por horário" eram gerados com
                  Math.random() e mudavam a cada abertura. Saem até existir série real do servidor. */}
              <div className="grid grid-cols-1 gap-5">
                {/* Pie chart: breakdown */}
                <div className="bg-muted/30 rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-1">Distribuição de Status</h3>
                  <p className="text-xs text-muted-foreground mb-4">Proporção de cada resultado</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "11px",
                        }}
                      />
                      <Legend
                        formatter={(value) => <span style={{ fontSize: "10px", color: "hsl(var(--muted-foreground))" }}>{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Funnel summary */}
              <div className="bg-muted/30 rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Funil de Conversão</h3>
                <div className="flex items-center gap-2">
                  {[
                    { label: "Enviadas", value: enviadas, pct: "100%", color: "bg-primary" },
                    { label: "Entregues", value: entregues, pct: taxaEntrega + "%", color: "bg-chart-2" },
                    { label: "Lidas", value: lidas, pct: taxaLeitura + "%", color: "bg-chart-3" },
                    { label: "Respondidas", value: respondidas, pct: taxaResposta + "%", color: "bg-chart-4" },
                  ].map((step, i, arr) => (
                    <div key={step.label} className="flex items-center gap-2 flex-1">
                      <div className="flex-1 text-center">
                        <div className={`h-2 rounded-full ${step.color} mb-2`} style={{ width: `${(step.value / Math.max(enviadas, 1)) * 100}%`, minWidth: "8px", margin: "0 auto" }} />
                        <p className="text-lg font-bold text-foreground">{step.value}</p>
                        <p className="text-[10px] text-muted-foreground">{step.label}</p>
                        <p className="text-[10px] font-medium text-foreground">{step.pct}</p>
                      </div>
                      {i < arr.length - 1 && (
                        <span className="text-muted-foreground/40 text-lg">→</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsKpi({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-muted/30 rounded-xl border border-border p-3.5 space-y-1">
      <div className={`flex items-center gap-1.5 ${color}`}>
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-foreground">{value.toLocaleString("pt-BR")}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
