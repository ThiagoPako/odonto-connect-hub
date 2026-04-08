import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { MessageSquare } from "lucide-react";

export const Route = createFileRoute("/chat")({
  component: ChatPage,
});

function ChatPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Chat" />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <MessageSquare className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Central de Atendimento</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            O módulo de chat com fila de espera, shared inbox e respostas rápidas será implementado aqui.
          </p>
        </div>
      </main>
    </div>
  );
}
