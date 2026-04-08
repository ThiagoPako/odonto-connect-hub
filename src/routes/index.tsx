import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { KpiCard } from "@/components/KpiCard";
import { ActiveAttendanceCard } from "@/components/ActiveAttendanceCard";
import { MessageSquare, Users, Phone, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

const mockAttendances = [
  {
    patientName: "Maria Silva",
    patientInitials: "MS",
    attendantName: "Ana",
    attendantInitials: "AR",
    lastMessage: "Gostaria de saber o valor do implante...",
    startedAt: new Date(Date.now() - 3 * 60 * 1000),
  },
  {
    patientName: "João Santos",
    patientInitials: "JS",
    attendantName: "Carla",
    attendantInitials: "CM",
    lastMessage: "Posso parcelar em quantas vezes?",
    startedAt: new Date(Date.now() - 7 * 60 * 1000),
  },
  {
    patientName: "Pedro Costa",
    patientInitials: "PC",
    attendantName: "Ana",
    attendantInitials: "AR",
    lastMessage: "Qual horário disponível para amanhã?",
    startedAt: new Date(Date.now() - 1 * 60 * 1000),
  },
  {
    patientName: "Lucia Ferreira",
    patientInitials: "LF",
    attendantName: "Beatriz",
    attendantInitials: "BL",
    lastMessage: "Obrigada, vou confirmar com meu marido",
    startedAt: new Date(Date.now() - 12 * 60 * 1000),
  },
];

function DashboardPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Dashboard" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Atendimentos Hoje"
            value="47"
            change="+12% vs ontem"
            changeType="positive"
            icon={MessageSquare}
          />
          <KpiCard
            title="Leads na Fila"
            value="8"
            change="3 aguardando >5min"
            changeType="negative"
            icon={Users}
          />
          <KpiCard
            title="Chamadas Realizadas"
            value="23"
            change="+5 esta hora"
            changeType="positive"
            icon={Phone}
          />
          <KpiCard
            title="Conversão do Dia"
            value="34%"
            change="Meta: 40%"
            changeType="neutral"
            icon={TrendingUp}
          />
        </div>

        {/* Active Attendances */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Atendimentos Ativos
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mockAttendances.map((a) => (
              <ActiveAttendanceCard key={a.patientName} {...a} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
