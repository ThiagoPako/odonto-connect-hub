import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  Search, DollarSign, CheckCircle2, Clock, TrendingUp,
  ArrowUpRight, CreditCard, Users, ChevronRight,
} from "lucide-react";
import { useState } from "react";
import {
  mockProfessionals, mockCommissions,
  type Professional, type CommissionEntry,
} from "@/data/comissoesMockData";

export const Route = createFileRoute("/comissoes")({
  component: ComissoesPage,
});

const statusCfg: Record<CommissionEntry["status"], { label: string; color: string; icon: React.ElementType }> = {
  pendente: { label: "Pendente", color: "bg-warning/15 text-warning", icon: Clock },
  aprovado: { label: "Aprovado", color: "bg-chart-1/15 text-chart-1", icon: CheckCircle2 },
  pago: { label: "Pago", color: "bg-success/15 text-success", icon: CreditCard },
};

function ComissoesPage() {
  const [selectedProf, setSelectedProf] = useState<Professional | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("todos");

  const profCommissions = (profId: string) => mockCommissions.filter((c) => c.professionalId === profId);

  const filteredEntries = (selectedProf
    ? profCommissions(selectedProf.id)
    : mockCommissions
  ).filter((c) => statusFilter === "todos" || c.status === statusFilter);

  const totalPending = mockCommissions.filter((c) => c.status === "pendente").reduce((s, c) => s + c.commissionValue, 0);
  const totalApproved = mockCommissions.filter((c) => c.status === "aprovado").reduce((s, c) => s + c.commissionValue, 0);
  const totalPaid = mockCommissions.filter((c) => c.status === "pago").reduce((s, c) => s + c.commissionValue, 0);
  const totalRevenue = mockCommissions.reduce((s, c) => s + c.procedureValue, 0);

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Gestão de Comissões" />
      <main className="flex-1 p-6 overflow-auto space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiBox icon={DollarSign} label="Faturamento Total" value={`R$ ${(totalRevenue / 1000).toFixed(1)}k`} color="text-primary" />
          <KpiBox icon={Clock} label="Pendente" value={`R$ ${totalPending.toFixed(0)}`} color="text-warning" />
          <KpiBox icon={CheckCircle2} label="Aprovado" value={`R$ ${totalApproved.toFixed(0)}`} color="text-chart-1" />
          <KpiBox icon={CreditCard} label="Pago" value={`R$ ${totalPaid.toFixed(0)}`} color="text-success" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Professional cards */}
          <div className="lg:col-span-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Profissionais</h3>
            <button
              onClick={() => setSelectedProf(null)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all text-xs font-medium ${
                !selectedProf ? "bg-primary/5 border-primary/30 text-primary" : "border-transparent hover:bg-muted text-muted-foreground"
              }`}
            >
              <Users className="inline h-3.5 w-3.5 mr-1.5" /> Todos os profissionais
            </button>
            {mockProfessionals.map((prof) => {
              const comms = profCommissions(prof.id);
              const earned = comms.reduce((s, c) => s + c.commissionValue, 0);
              const revenue = comms.reduce((s, c) => s + c.procedureValue, 0);
              const pending = comms.filter((c) => c.status === "pendente").reduce((s, c) => s + c.commissionValue, 0);
              return (
                <button
                  key={prof.id}
                  onClick={() => setSelectedProf(prof)}
                  className={`w-full text-left px-3 py-3 rounded-xl border transition-all ${
                    selectedProf?.id === prof.id ? "bg-primary/5 border-primary/30" : "border-transparent hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={`h-8 w-8 rounded-full ${prof.avatarColor} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                      {prof.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{prof.name}</p>
                      <p className="text-[10px] text-muted-foreground">{prof.specialty} · {prof.commissionRate}%</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <MiniStat label="Faturado" value={`R$ ${(revenue / 1000).toFixed(1)}k`} />
                    <MiniStat label="Comissão" value={`R$ ${earned.toFixed(0)}`} />
                    <MiniStat label="Pendente" value={`R$ ${pending.toFixed(0)}`} accent />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Entries table */}
          <div className="lg:col-span-8 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {selectedProf ? `Comissões — ${selectedProf.name}` : "Todas as Comissões"}
              </h3>
              <div className="flex items-center gap-1.5">
                {["todos", "pendente", "aprovado", "pago"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                      statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s === "todos" ? "Todos" : statusCfg[s as CommissionEntry["status"]].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Profissional</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Paciente</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Procedimento</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Valor Proc.</th>
                      <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">%</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Comissão</th>
                      <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry) => {
                      const prof = mockProfessionals.find((p) => p.id === entry.professionalId)!;
                      const cfg = statusCfg[entry.status];
                      return (
                        <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className={`h-6 w-6 rounded-full ${prof.avatarColor} flex items-center justify-center text-[8px] font-bold text-white`}>
                                {prof.initials}
                              </div>
                              <span className="text-foreground font-medium truncate max-w-[100px]">{prof.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-foreground">{entry.patientName}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{entry.procedure}</td>
                          <td className="px-4 py-2.5 text-right text-foreground font-medium">
                            R$ {entry.procedureValue.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-2.5 text-center text-muted-foreground">{entry.commissionRate}%</td>
                          <td className="px-4 py-2.5 text-right font-bold text-foreground">
                            R$ {entry.commissionValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>
                              <cfg.icon className="h-2.5 w-2.5" /> {cfg.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredEntries.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nenhuma comissão encontrada.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function KpiBox({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className={`text-[11px] font-bold ${accent ? "text-warning" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
