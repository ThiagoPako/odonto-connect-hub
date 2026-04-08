import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { RefreshCcw, MessageSquare, Send, Clock, Users } from "lucide-react";

export const Route = createFileRoute("/reativacao")({
  component: ReativacaoPage,
});

const reactivationLists = [
  { id: "1", title: "Pacientes inativos >90 dias", count: 23, lastRun: "Há 3 dias", icon: Clock },
  { id: "2", title: "Orçamentos não fechados", count: 15, lastRun: "Há 1 dia", icon: RefreshCcw },
  { id: "3", title: "Leads sem resposta >7 dias", count: 8, lastRun: "Nunca", icon: MessageSquare },
  { id: "4", title: "Pacientes sem retorno agendado", count: 12, lastRun: "Há 5 dias", icon: Users },
];

function ReativacaoPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Reativação Inteligente" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Listas Inteligentes</h2>
            <p className="text-sm text-muted-foreground">Listas auto-geradas para reativação de pacientes e leads</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reactivationLists.map((list) => (
            <div key={list.id} className="bg-card rounded-xl border border-border p-5 space-y-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                    <list.icon className="h-5 w-5 text-warning" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-card-foreground">{list.title}</p>
                    <p className="text-xs text-muted-foreground">Última execução: {list.lastRun}</p>
                  </div>
                </div>
                <span className="text-2xl font-bold text-card-foreground">{list.count}</span>
              </div>

              <div className="flex gap-2">
                <button className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                  <Send className="h-3.5 w-3.5" /> Enviar Campanha
                </button>
                <button className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors">
                  <Users className="h-3.5 w-3.5" /> Ver Lista
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
