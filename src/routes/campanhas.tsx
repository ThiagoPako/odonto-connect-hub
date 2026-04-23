import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { MetaAdsDashboard } from "@/components/MetaAdsDashboard";
import { CampanhasManager } from "@/components/campanhas/CampanhasManager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/campanhas")({
  ssr: false,
  component: CampanhasPage,
});

function CampanhasPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Campanhas & Meta Ads" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <Tabs defaultValue="campanhas" className="space-y-4">
          <TabsList>
            <TabsTrigger value="campanhas">Minhas campanhas</TabsTrigger>
            <TabsTrigger value="meta-ads">Meta Ads</TabsTrigger>
          </TabsList>
          <TabsContent value="campanhas">
            <CampanhasManager />
          </TabsContent>
          <TabsContent value="meta-ads">
            <MetaAdsDashboard />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
