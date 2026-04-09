import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { AdminResetPanel } from "@/components/AdminResetPanel";
import { AdminCreateUserPanel } from "@/components/AdminCreateUserPanel";
import { AdminUserListPanel } from "@/components/AdminUserListPanel";
import { ClinicLocationPanel } from "@/components/ClinicLocationPanel";
import { NotificationSettingsPanel } from "@/components/NotificationSettingsPanel";
import { QueueManagementPanel } from "@/components/QueueManagementPanel";
import { AttendanceSettingsPanel } from "@/components/AttendanceSettingsPanel";
import { TagManagementPanel } from "@/components/TagManagementPanel";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/configuracoes")({
  ssr: false,
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Configurações" />
      <main className="flex-1 p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Configurações</h2>
            <p className="text-sm text-muted-foreground">
              Dados da clínica, permissões e administração
            </p>
          </div>
        </div>

        <div className="max-w-3xl space-y-6">
          <TagManagementPanel />
          <AttendanceSettingsPanel />
          <QueueManagementPanel />
          <ClinicLocationPanel />
          <NotificationSettingsPanel />
          <AdminUserListPanel />
          <AdminCreateUserPanel />
          <AdminResetPanel />
        </div>
      </main>
    </div>
  );
}
