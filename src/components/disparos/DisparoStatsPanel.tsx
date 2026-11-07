import { useEffect, useState } from "react";
import { X, Send, Clock, AlertTriangle, Ban, BarChart3, Loader2, Info } from "lucide-react";
import { type DisparoProgramado } from "@/data/disparosMockData";
import { campaignsApi } from "@/lib/vpsApi";

interface DisparoStatsPanelProps {
  disparo: DisparoProgramado;
  onClose: () => void;
}

type JobsData = NonNullable<Awaited<ReturnType<typeof campaignsApi.jobs>>["data"]>;

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  sent: { label: "Enviada", className: "bg-success/15 text-success" },
  pending: { label: "Na fila", className: "bg-primary/10 text-primary" },
  failed: { label: "Falhou", className: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Cancelada", className: "bg-muted text-muted-foreground" },
};

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

// Números reais da fila de envio desta campanha (GET /api/campaigns/:id/jobs).
// Antes os gráficos eram gerados com Math.random e entregue/lida/respondida, que o
// sistema não mede, apareciam como 0%.
export function DisparoStatsPanel({ disparo, onClose }: DisparoStatsPanelProps) {
  const [data, setData] = useState<JobsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    campaignsApi.jobs(disparo.id).then(({ data, error }) => {
      if (!alive) return;
      if (error) setError(error);
      else setData(data ?? { summary: {}, recent: [] });
    });
    return () => { alive = false; };
  }, [disparo.id]);

  const s = data?.summary ?? {};
  const enviadas = s.sent || 0;
  const naFila = s.pending || 0;
  const falharam = s.failed || 0;
  const canceladas = Object.entries(s)
    .filter(([k]) => !["sent", "pending", "failed"].includes(k))
    .reduce((a, [, v]) => a + (v || 0), 0);
  const total = enviadas + naFila + falharam + canceladas;
  const taxaFalha = enviadas + falharam > 0 ? ((falharam / (enviadas + falharam)) * 100).toFixed(1) : "0";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="disparo-stats-titulo">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-[860px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 id="disparo-stats-titulo" className="text-base font-semibold text-foreground truncate">{disparo.nome}</h2>
              <p className="text-xs text-muted-foreground">Situação da fila de envio · Criado em {disparo.criadoEm}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Não foi possível carregar as estatísticas: {error}
            </div>
          ) : !data ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatsKpi icon={Send} label="Enviadas" value={enviadas} color="text-success" />
                <StatsKpi icon={Clock} label="Na fila" value={naFila} color="text-primary" />
                <StatsKpi icon={AlertTriangle} label="Falharam" value={falharam} sub={`${taxaFalha}% das tentativas`} color="text-destructive" />
                <StatsKpi icon={Ban} label="Canceladas" value={canceladas} sub="SAIR, pausa ou validade" color="text-muted-foreground" />
              </div>

              <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Entrega, leitura e respostas ainda não são medidas pelo sistema. Os números acima são da fila de envio desta campanha.
              </p>

              {total === 0 ? (
                <div className="bg-muted/50 rounded-xl p-10 text-center">
                  <p className="text-sm font-medium text-foreground mb-1">Sem envios ainda</p>
                  <p className="text-xs text-muted-foreground">Os números aparecem quando o disparo colocar mensagens na fila.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border bg-muted/30">
                    <h3 className="text-sm font-semibold text-foreground">Últimos envios</h3>
                    <p className="text-[11px] text-muted-foreground">Até 50 mais recentes</p>
                  </div>
                  <ul className="divide-y divide-border">
                    {data.recent.map((j, i) => {
                      const st = STATUS_LABEL[j.status] ?? { label: j.status, className: "bg-muted text-muted-foreground" };
                      return (
                        <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
                          <span className="font-medium text-foreground min-w-0 flex-1 truncate">{j.patient_name || "Sem nome"}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${st.className}`}>{st.label}</span>
                          <span className="text-muted-foreground tabular-nums">{formatDateTime(j.sent_at || j.scheduled_at)}</span>
                          {j.error && <span className="basis-full text-[11px] text-muted-foreground">{j.error}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
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
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-foreground tabular-nums">{value.toLocaleString("pt-BR")}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
