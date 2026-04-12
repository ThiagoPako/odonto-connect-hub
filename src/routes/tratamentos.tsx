import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Search, CheckCircle2, Clock, Pause, PlayCircle, CalendarDays,
  FileText, Plus, Loader2,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { tratamentosApi } from "@/lib/vpsApi";

export const Route = createFileRoute("/tratamentos")({
  ssr: false,
  component: TratamentosPage,
});

interface TratamentoRow {
  id: string;
  paciente_id: string;
  paciente_nome: string;
  dentista_nome: string;
  descricao: string;
  dente: string;
  valor: number;
  status: string;
  plano: string;
  observacoes: string;
  created_at: string;
}

interface EtapaRow {
  id: string;
  tratamento_id: string;
  descricao: string;
  dente: string;
  valor: number;
  status: string;
  dentista_nome: string;
  data_realizada: string;
  ordem: number;
  observacoes: string;
}

const treatmentStatusCfg: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  planejado: { label: "Planejado", color: "bg-chart-1/15 text-chart-1", icon: FileText },
  em_andamento: { label: "Em Andamento", color: "bg-primary/15 text-primary", icon: PlayCircle },
  pausado: { label: "Pausado", color: "bg-warning/15 text-warning", icon: Pause },
  finalizado: { label: "Finalizado", color: "bg-muted text-muted-foreground", icon: CheckCircle2 },
};

const stepStatusCfg: Record<string, { label: string; color: string }> = {
  pendente: { label: "Pendente", color: "bg-muted text-muted-foreground" },
  agendado: { label: "Agendado", color: "bg-chart-1/15 text-chart-1" },
  realizado: { label: "Realizado", color: "bg-success/15 text-success" },
  cancelado: { label: "Cancelado", color: "bg-destructive/15 text-destructive" },
};

function getInitials(name: string) {
  return name.split(" ").filter((_, i, a) => i === 0 || i === a.length - 1).map(n => n[0]).join("").toUpperCase();
}

const AVATAR_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-primary"];

function TratamentosPage() {
  const [tratamentos, setTratamentos] = useState<TratamentoRow[]>([]);
  const [etapas, setEtapas] = useState<EtapaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const res = await tratamentosApi.list();
      const data = (res as any).data || res || [];
      setTratamentos(Array.isArray(data) ? data.map((r: any) => ({
        id: r.id,
        paciente_id: r.paciente_id || '',
        paciente_nome: r.paciente_nome || '',
        dentista_nome: r.dentista_nome || '',
        descricao: r.descricao || '',
        dente: r.dente || '',
        valor: Number(r.valor) || 0,
        status: r.status || 'planejado',
        plano: r.plano || '',
        observacoes: r.observacoes || '',
        created_at: r.created_at || '',
      })) : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadEtapas = useCallback(async (tratId: string) => {
    try {
      const res = await tratamentosApi.getEtapas(tratId);
      const data = (res as any).data || res || [];
      setEtapas(Array.isArray(data) ? data.map((r: any) => ({
        id: r.id,
        tratamento_id: r.tratamento_id,
        descricao: r.descricao || '',
        dente: r.dente || '',
        valor: Number(r.valor) || 0,
        status: r.status || 'pendente',
        dentista_nome: r.dentista_nome || '',
        data_realizada: r.data_realizada || '',
        ordem: Number(r.ordem) || 0,
        observacoes: r.observacoes || '',
      })) : []);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    if (selectedId) loadEtapas(selectedId);
    else setEtapas([]);
  }, [selectedId, loadEtapas]);

  const filtered = tratamentos.filter(
    t => !searchTerm || t.paciente_nome.toLowerCase().includes(searchTerm.toLowerCase()) || t.descricao.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selected = tratamentos.find(t => t.id === selectedId) || null;
  const completedSteps = etapas.filter(e => e.status === "realizado").length;
  const totalSteps = etapas.length;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Gestão de Tratamentos" />
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Gestão de Tratamentos" />
      <main className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Treatment list */}
          <div className="lg:col-span-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input type="text" placeholder="Buscar tratamento..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-muted border-0 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="space-y-1.5 max-h-[calc(100vh-200px)] overflow-y-auto">
              {filtered.map((t, i) => {
                const cfg = treatmentStatusCfg[t.status] || treatmentStatusCfg.planejado;
                return (
                  <button key={t.id} onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left px-3 py-3 rounded-xl border transition-all duration-300 hover-lift ${selectedId === t.id ? "bg-primary/5 border-primary/30 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.3)]" : "border-transparent hover:bg-muted hover:shadow-card"}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`h-7 w-7 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
                        {getInitials(t.paciente_nome || '?')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{t.paciente_nome}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{t.dentista_nome || t.descricao}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-[10px] text-muted-foreground">R$ {t.valor.toLocaleString("pt-BR")}</span>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">Nenhum tratamento encontrado</p>}
            </div>
          </div>

          {/* Detail area */}
          <div className="lg:col-span-9 space-y-4">
            {selected ? (
              <>
                {/* Header */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{selected.paciente_nome}</h3>
                      <p className="text-xs text-muted-foreground">{selected.dentista_nome} · {selected.descricao}</p>
                      {selected.plano && <p className="text-xs text-muted-foreground mt-0.5">Plano: {selected.plano}</p>}
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${(treatmentStatusCfg[selected.status] || treatmentStatusCfg.planejado).color}`}>
                      {(treatmentStatusCfg[selected.status] || treatmentStatusCfg.planejado).label}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <StatBox label="Progresso" value={totalSteps > 0 ? `${progress.toFixed(0)}%` : 'N/A'} />
                    <StatBox label="Etapas" value={`${completedSteps}/${totalSteps}`} />
                    <StatBox label="Valor Total" value={`R$ ${(selected.valor / 1000).toFixed(1)}k`} />
                    <StatBox label="Criado em" value={selected.created_at ? new Date(selected.created_at).toLocaleDateString("pt-BR") : '-'} />
                  </div>
                  {totalSteps > 0 && (
                    <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                </div>

                {/* Steps timeline */}
                <div className="bg-card rounded-xl border border-border p-5">
                  <h4 className="text-sm font-semibold text-card-foreground mb-4">Etapas do Tratamento</h4>
                  {etapas.length > 0 ? (
                    <div className="space-y-0">
                      {etapas.map((step, i) => {
                        const sCfg = stepStatusCfg[step.status] || stepStatusCfg.pendente;
                        return (
                          <div key={step.id} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                step.status === "realizado" ? "bg-success text-white" :
                                step.status === "agendado" ? "bg-chart-1/20 text-chart-1" :
                                "bg-muted text-muted-foreground"
                              }`}>
                                {step.status === "realizado" ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.ordem || (i + 1)}
                              </div>
                              {i < etapas.length - 1 && <div className="w-px flex-1 bg-border my-1" />}
                            </div>
                            <div className={`flex-1 ${i < etapas.length - 1 ? "pb-4" : ""}`}>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs font-medium text-foreground">{step.descricao}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${sCfg.color}`}>{sCfg.label}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                {step.dente && <span>Dente: {step.dente}</span>}
                                {step.dentista_nome && <span>· {step.dentista_nome}</span>}
                                {step.data_realizada && (
                                  <span className="flex items-center gap-0.5">
                                    <CheckCircle2 className="h-2.5 w-2.5 text-success" />
                                    {new Date(step.data_realizada).toLocaleDateString("pt-BR")}
                                  </span>
                                )}
                                {step.valor > 0 && <span>· R$ {step.valor.toLocaleString("pt-BR")}</span>}
                              </div>
                              {step.observacoes && <p className="text-[10px] text-muted-foreground/70 mt-1 italic">{step.observacoes}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-8">Nenhuma etapa cadastrada para este tratamento.</p>
                  )}
                </div>

                {/* Observações */}
                {selected.observacoes && (
                  <div className="bg-card rounded-xl border border-border p-5">
                    <h4 className="text-sm font-semibold text-card-foreground mb-2">Observações</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">{selected.observacoes}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 flex flex-col items-center justify-center text-center min-h-[400px]">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">Selecione um tratamento</h3>
                <p className="text-xs text-muted-foreground">Clique em um tratamento ao lado para ver detalhes.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-2.5 text-center">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}
