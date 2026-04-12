import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { MetaAdsDashboard } from "@/components/MetaAdsDashboard";

export const Route = createFileRoute("/campanhas")({
  ssr: false,
  component: CampanhasPage,
});

function CampanhasPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Campanhas & Meta Ads" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <MetaAdsDashboard />
      </main>
    </div>
  );
}
