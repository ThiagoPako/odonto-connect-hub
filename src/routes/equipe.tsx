import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { UserCog, Wifi, WifiOff, Clock, MessageSquare, Phone } from "lucide-react";

export const Route = createFileRoute("/equipe")({
  ssr: false,
  component: EquipePage,
});

const teamMembers = [
  { name: "Ana Ribeiro", initials: "AR", role: "Consultora de Vendas", status: "online" as const, attending: "Pedro Costa", responseTime: "1.2min", chatsToday: 18 },
  { name: "Carla Mendes", initials: "CM", role: "Recepcionista", status: "attending" as const, attending: "Maria Silva", responseTime: "2.8min", chatsToday: 14 },
  { name: "Beatriz Lima", initials: "BL", role: "Consultora de Vendas", status: "online" as const, attending: null, responseTime: "0.9min", chatsToday: 22 },
  { name: "Dr. Marcos", initials: "DM", role: "Administrador", status: "offline" as const, attending: null, responseTime: "—", chatsToday: 0 },
];

const statusConfig = {
  online: { label: "Online", className: "bg-success", dotClass: "bg-success" },
  attending: { label: "Em atendimento", className: "bg-warning", dotClass: "bg-warning" },
  offline: { label: "Offline", className: "bg-muted-foreground/30", dotClass: "bg-muted-foreground/40" },
};

function EquipePage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Equipe" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Monitoramento em Tempo Real</h2>
          <p className="text-sm text-muted-foreground">Acompanhe a equipe e performance individual</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-slide-up" style={{ animationFillMode: 'both' }}>
          {teamMembers.map((member, index) => {
            const st = statusConfig[member.status];
            return (
              <div key={member.name} className={`bg-card rounded-xl border p-5 hover-lift hover:shadow-glow-primary transition-all duration-300 relative overflow-hidden animate-slide-up ${
                member.status === "online" ? "border-success/30" : member.status === "attending" ? "border-warning/30 shadow-[0_0_16px_-4px_hsl(var(--warning)/0.2)]" : "border-border"
              }`} style={{ animationDelay: `${index * 80}ms`, animationFillMode: 'both' }}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center text-sm font-bold text-primary">
                        {member.initials}
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${st.dotClass}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-card-foreground">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.role}</p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                    member.status === "online" ? "bg-success/15 text-success" :
                    member.status === "attending" ? "bg-warning/15 text-warning" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {st.label}
                  </span>
                </div>

                {member.attending && (
                  <div className="bg-muted/50 rounded-lg p-3 mb-3">
                    <p className="text-[11px] text-muted-foreground mb-1">Atendendo agora</p>
                    <p className="text-sm font-medium text-foreground">{member.attending}</p>
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Resp: {member.responseTime}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{member.chatsToday} chats hoje</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
