import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Radio, Wifi, WifiOff, Shield } from "lucide-react";

export const Route = createFileRoute("/canais")({
  component: CanaisPage,
});

const mockChannels = [
  { number: "+55 11 99999-0001", label: "Principal", status: "online" as const, priority: "principal" as const },
  { number: "+55 11 99999-0002", label: "Reserva 1", status: "online" as const, priority: "reserva" as const },
  { number: "+55 11 99999-0003", label: "Reserva 2", status: "offline" as const, priority: "reserva" as const },
];

function CanaisPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Canais WhatsApp" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Protocolo Phoenix</h2>
            <p className="text-sm text-muted-foreground">Gerenciamento de números e redundância automática</p>
          </div>
          <button className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            + Adicionar Número
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockChannels.map((ch) => (
            <div key={ch.number} className="bg-card rounded-xl border border-border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="h-5 w-5 text-primary" />
                  <span className="font-medium text-card-foreground">{ch.label}</span>
                </div>
                {ch.priority === "principal" && (
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    Principal
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground font-mono">{ch.number}</p>
              <div className="flex items-center gap-2">
                {ch.status === "online" ? (
                  <>
                    <Wifi className="h-4 w-4 text-success" />
                    <span className="text-xs text-success font-medium">Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-4 w-4 text-destructive" />
                    <span className="text-xs text-destructive font-medium">Offline</span>
                  </>
                )}
                <Shield className="h-4 w-4 text-muted-foreground ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
