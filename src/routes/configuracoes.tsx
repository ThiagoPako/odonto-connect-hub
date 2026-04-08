import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/configuracoes")({
  ssr: false,
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Configurações" />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Settings className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Configurações</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Dados da clínica, permissões de atendentes, integrações e chaves de API.
          </p>
        </div>
      </main>
    </div>
  );
}
