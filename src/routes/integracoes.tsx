import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { MetaAdsConnectPanel } from "@/components/meta-ads/MetaAdsConnectPanel";
import { MetaAdsDashboard } from "@/components/MetaAdsDashboard";
import { ClinicorpPanel } from "@/components/ClinicorpPanel";

export const Route = createFileRoute("/integracoes")({
  ssr: false,
  component: IntegracoesPage,
});

function IntegracoesPage() {
  // Recarrega o painel do Meta Ads depois que o formulário conecta/sincroniza
  const [dashboardKey, setDashboardKey] = useState(0);

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Integrações" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <Tabs defaultValue="trafego" className="space-y-6">
          <TabsList>
            <TabsTrigger value="trafego">Tráfego Pago</TabsTrigger>
            <TabsTrigger value="clinicorp">Clinicorp</TabsTrigger>
          </TabsList>

          <TabsContent value="trafego" className="space-y-6">
            {/* Meta Ads: token + ID da conta de anúncios */}
            <MetaAdsConnectPanel onSynced={() => setDashboardKey((k) => k + 1)} />

            {/* Painel com os dados reais do Meta Ads */}
            <MetaAdsDashboard key={dashboardKey} />

            <p className="text-xs text-muted-foreground">
              <span className="mr-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Em breve</span>
              Google Ads.
            </p>
          </TabsContent>

          <TabsContent value="clinicorp">
            <ClinicorpPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
