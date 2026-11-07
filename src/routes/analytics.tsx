import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { EmBreve } from "@/components/EmBreve";

export const Route = createFileRoute("/analytics")({
  ssr: false,
  component: AnalyticsPage,
});

// Antes esta tela mostrava ROI, custo por lead e campanhas escritos no código
// (números inventados). Fica como "em breve" até existir cálculo com dados reais.
function AnalyticsPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="ROI & Analytics" />
      <div className="flex-1 p-4 sm:p-6 overflow-auto">
        <EmBreve
          titulo="ROI e análise de campanhas"
          descricao="Estamos preparando o cálculo de retorno das campanhas com os dados reais da sua clínica (investimento, leads e pacientes fechados). Enquanto isso, acompanhe os números que já são reais."
          atalhos={[
            { to: "/dashboard", label: "Ver painel" },
            { to: "/painel-comercial", label: "Painel comercial" },
          ]}
        />
      </div>
    </div>
  );
}
