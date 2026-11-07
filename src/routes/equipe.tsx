import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { EmBreve } from "@/components/EmBreve";

export const Route = createFileRoute("/equipe")({
  ssr: false,
  component: EquipePage,
});

// Antes esta tela listava pessoas fictícias como se estivessem online.
// Fica como "em breve" até o monitoramento ao vivo usar os usuários reais.
function EquipePage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Equipe" />
      <div className="flex-1 p-4 sm:p-6 overflow-auto">
        <EmBreve
          titulo="Monitoramento da equipe em tempo real"
          descricao="Em breve você verá aqui quem está online e em atendimento. Para gerenciar quem tem acesso ou ver o desempenho do atendimento, use as telas abaixo."
          atalhos={[
            { to: "/usuarios", label: "Usuários da clínica" },
            { to: "/metricas", label: "Métricas de atendimento" },
          ]}
        />
      </div>
    </div>
  );
}
