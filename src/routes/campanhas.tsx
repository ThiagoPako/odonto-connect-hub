import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Megaphone, Plus, Send, BarChart3, Users } from "lucide-react";

export const Route = createFileRoute("/campanhas")({
  component: CampanhasPage,
});

const mockCampaigns = [
  { id: "1", name: "Reativação Implantes Q1", status: "ativa", sent: 234, delivered: 228, responded: 45, date: "05/04/2026" },
  { id: "2", name: "Clareamento Promoção", status: "finalizada", sent: 180, delivered: 175, responded: 62, date: "28/03/2026" },
  { id: "3", name: "Follow-up Orçamentos Março", status: "finalizada", sent: 89, delivered: 87, responded: 23, date: "20/03/2026" },
  { id: "4", name: "Lembrete Retorno Semestral", status: "rascunho", sent: 0, delivered: 0, responded: 0, date: "—" },
];

function CampanhasPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Campanhas" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Disparos em Massa</h2>
            <p className="text-sm text-muted-foreground">Gerencie campanhas de mensagens segmentadas</p>
          </div>
          <button className="flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" /> Nova Campanha
          </button>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Campanha</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Enviadas</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Entregues</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Respondidas</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Data</th>
              </tr>
            </thead>
            <tbody>
              {mockCampaigns.map((c) => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Megaphone className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      c.status === "ativa" ? "bg-success/15 text-success" :
                      c.status === "finalizada" ? "bg-muted text-muted-foreground" :
                      "bg-warning/15 text-warning"
                    }`}>
                      {c.status === "ativa" ? "Ativa" : c.status === "finalizada" ? "Finalizada" : "Rascunho"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-foreground">{c.sent || "—"}</td>
                  <td className="px-4 py-3 text-center text-sm text-foreground">{c.delivered || "—"}</td>
                  <td className="px-4 py-3 text-center text-sm font-medium text-primary">{c.responded || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{c.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
