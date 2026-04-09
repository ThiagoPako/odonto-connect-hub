import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { AttendanceMetricsPanel } from "@/components/AttendanceMetricsPanel";
import { BarChart3 } from "lucide-react";

export const Route = createFileRoute("/metricas")({
  ssr: false,
  component: MetricasPage,
});

function MetricasPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Métricas de Atendimento" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <BarChart3 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Métricas de Atendimento</h2>
            <p className="text-sm text-muted-foreground">
              Tempo de espera, resposta, duração e avaliações dos atendentes
            </p>
          </div>
        </div>
        <AttendanceMetricsPanel />
      </main>
    </div>
  );
}
