import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { UserProfilePanel } from "@/components/UserProfilePanel";

export const Route = createFileRoute("/perfil")({
  ssr: false,
  component: PerfilPage,
});

function PerfilPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Meu Perfil" />
      <main className="flex-1 p-6 max-w-3xl overflow-auto">
        <UserProfilePanel />
      </main>
    </div>
  );
}
