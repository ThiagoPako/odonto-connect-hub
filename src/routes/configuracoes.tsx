import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { AdminResetPanel } from "@/components/AdminResetPanel";
import { AdminCreateUserPanel } from "@/components/AdminCreateUserPanel";
import { AdminUserListPanel } from "@/components/AdminUserListPanel";
import { ClinicLocationPanel } from "@/components/ClinicLocationPanel";
import { NotificationSettingsPanel } from "@/components/NotificationSettingsPanel";
import { QueueManagementPanel } from "@/components/QueueManagementPanel";
import { AttendanceSettingsPanel } from "@/components/AttendanceSettingsPanel";
import { TagManagementPanel } from "@/components/TagManagementPanel";
import { AISettingsPanel } from "@/components/AISettingsPanel";
import {
  Settings,
  Building2,
  Users,
  Bell,
  Tag,
  Bot,
  Headphones,
  ShieldAlert,
  CalendarClock,
  ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/configuracoes")({
  ssr: false,
  component: ConfiguracoesPage,
});

type TabId =
  | "clinica"
  | "atendimento"
  | "ia"
  | "tags"
  | "notificacoes"
  | "usuarios"
  | "avancado";

interface TabDef {
  id: TabId;
  label: string;
  description: string;
  icon: React.ElementType;
}

const TABS: TabDef[] = [
  { id: "clinica", label: "Clínica", description: "Endereço e dados da unidade", icon: Building2 },
  { id: "atendimento", label: "Atendimento", description: "Fila, regras e tempo de atendimento", icon: Headphones },
  { id: "ia", label: "Inteligência Artificial", description: "Provedor, chave e modelos da IA", icon: Bot },
  { id: "tags", label: "Tags", description: "Etiquetas usadas em leads e contatos", icon: Tag },
  { id: "notificacoes", label: "Notificações", description: "Som, push e alertas do sistema", icon: Bell },
  { id: "usuarios", label: "Usuários", description: "Equipe e permissões de acesso", icon: Users },
  { id: "avancado", label: "Avançado", description: "Reset e operações administrativas", icon: ShieldAlert },
];

function ConfiguracoesPage() {
  const [activeTab, setActiveTab] = useState<TabId>("clinica");
  const current = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Configurações" />
      <main className="flex-1 p-6 overflow-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Configurações</h2>
            <p className="text-sm text-muted-foreground">
              Organize sua clínica, equipe e automações
            </p>
          </div>
        </div>

        {/* Layout: sidebar + content */}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
          {/* Sidebar de abas */}
          <aside className="bg-card rounded-xl border border-border/60 shadow-card p-2 h-fit lg:sticky lg:top-6">
            <nav className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap lg:whitespace-normal ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Conteúdo da aba */}
          <section className="space-y-4 min-w-0">
            <div className="bg-card rounded-xl border border-border/60 shadow-card p-5">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <current.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">{current.label}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{current.description}</p>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {activeTab === "clinica" && <ClinicLocationPanel />}

              {activeTab === "atendimento" && (
                <>
                  <AttendanceSettingsPanel />
                  <QueueManagementPanel />
                </>
              )}

              {activeTab === "ia" && <AISettingsPanel />}

              {activeTab === "tags" && <TagManagementPanel />}

              {activeTab === "notificacoes" && <NotificationSettingsPanel />}

              {activeTab === "usuarios" && (
                <>
                  <AdminUserListPanel />
                  <AdminCreateUserPanel />
                </>
              )}

              {activeTab === "avancado" && <AdminResetPanel />}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
