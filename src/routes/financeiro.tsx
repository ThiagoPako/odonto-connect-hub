import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { DollarSign } from "lucide-react";

export const Route = createFileRoute("/financeiro")({
  component: FinanceiroPage,
});

function FinanceiroPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Financeiro" />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <DollarSign className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Gestão Financeira</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Controle de inadimplência, links de pagamento Pix/Cartão e integração com Clinicorp.
          </p>
        </div>
      </main>
    </div>
  );
}
