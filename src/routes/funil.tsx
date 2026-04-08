import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { mockKanbanLeads, kanbanStages, type KanbanStage, type KanbanLead } from "@/data/crmMockData";
import { Clock, GripVertical, Phone, MessageSquare, MoreHorizontal, Plus } from "lucide-react";

export const Route = createFileRoute("/funil")({
  component: FunilPage,
});

function FunilPage() {
  const [leads, setLeads] = useState(mockKanbanLeads);
  const [draggedLead, setDraggedLead] = useState<{ lead: KanbanLead; fromStage: KanbanStage } | null>(null);

  const handleDragStart = (lead: KanbanLead, fromStage: KanbanStage) => {
    setDraggedLead({ lead, fromStage });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (toStage: KanbanStage) => {
    if (!draggedLead) return;
    if (draggedLead.fromStage === toStage) return;

    setLeads((prev) => {
      const updated = { ...prev };
      updated[draggedLead.fromStage] = prev[draggedLead.fromStage].filter(
        (l) => l.id !== draggedLead.lead.id
      );
      updated[toStage] = [...prev[toStage], draggedLead.lead];
      return updated;
    });
    setDraggedLead(null);
  };

  const totalValue = Object.values(leads).flat().reduce((sum, l) => sum + l.value, 0);

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Funil de Vendas" />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Summary bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-xs text-muted-foreground">Total no funil</span>
              <p className="text-lg font-bold text-foreground">
                {Object.values(leads).flat().length} leads
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Valor total</span>
              <p className="text-lg font-bold text-foreground">
                R$ {totalValue.toLocaleString("pt-BR")}
              </p>
            </div>
          </div>
          <button className="flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" />
            Novo Lead
          </button>
        </div>

        {/* Kanban Board */}
        <div className="flex-1 flex gap-3 p-4 overflow-x-auto">
          {kanbanStages.map((stage) => {
            const stageLeads = leads[stage.id];
            const stageValue = stageLeads.reduce((sum, l) => sum + l.value, 0);

            return (
              <div
                key={stage.id}
                className="flex flex-col w-[280px] shrink-0 bg-muted/30 rounded-xl"
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(stage.id)}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 px-3 py-3 border-b border-border/50">
                  <div className={`h-2.5 w-2.5 rounded-full ${stage.color}`} />
                  <span className="text-sm font-semibold text-foreground flex-1">{stage.label}</span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {stageLeads.length}
                  </span>
                </div>

                {/* Value summary */}
                {stageValue > 0 && (
                  <div className="px-3 py-1.5">
                    <span className="text-[11px] text-muted-foreground">
                      R$ {stageValue.toLocaleString("pt-BR")}
                    </span>
                  </div>
                )}

                {/* Cards */}
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                  {stageLeads.map((lead) => (
                    <KanbanCard
                      key={lead.id}
                      lead={lead}
                      onDragStart={() => handleDragStart(lead, stage.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function KanbanCard({ lead, onDragStart }: { lead: KanbanLead; onDragStart: () => void }) {
  const daysAgo = Math.floor((Date.now() - lead.lastContact.getTime()) / 86400000);
  const isStale = daysAgo > 3;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`bg-card rounded-lg border p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
        isStale ? "border-warning/50" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`h-8 w-8 rounded-full ${lead.avatarColor} flex items-center justify-center text-[10px] font-bold text-primary-foreground`}>
            {lead.initials}
          </div>
          <div>
            <p className="text-sm font-medium text-card-foreground leading-tight">{lead.name}</p>
            <p className="text-[11px] text-muted-foreground">{lead.origin}</p>
          </div>
        </div>
        <button className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="text-sm font-semibold text-primary mb-2">
        R$ {lead.value.toLocaleString("pt-BR")}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center text-[8px] font-bold text-primary">
            {lead.assignedInitials}
          </div>
          <span className="text-[11px] text-muted-foreground">{lead.assignedTo}</span>
        </div>

        <div className="flex items-center gap-2">
          <button className="p-1 rounded hover:bg-muted text-muted-foreground"><Phone className="h-3 w-3" /></button>
          <button className="p-1 rounded hover:bg-muted text-muted-foreground"><MessageSquare className="h-3 w-3" /></button>
          <div className={`flex items-center gap-0.5 ${isStale ? "text-warning" : "text-muted-foreground/50"}`}>
            <Clock className="h-3 w-3" />
            <span className="text-[10px]">{daysAgo}d</span>
          </div>
        </div>
      </div>
    </div>
  );
}
