import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, ExternalLink, Phone } from "lucide-react";
import { CANAIS, type Campaign } from "@/data/campanhasStore";
import { mockKanbanLeads } from "@/data/crmMockData";

interface Props {
  campaign: Campaign;
  onNavigate?: () => void;
}

interface LeadRow {
  hitIndex: number;
  leadId?: string;
  name: string;
  phone: string;
  canal: string;
  canalIcon: string;
  canalLabel: string;
  timestamp: number;
  convertido?: boolean;
  valor?: number;
}

const PAGE_SIZE = 8;

export function CampanhaLeadsTable({ campaign, onNavigate }: Props) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  const phoneByLeadId = useMemo(() => {
    const map = new Map<string, string>();
    for (const stage of Object.values(mockKanbanLeads)) {
      for (const lead of stage) map.set(lead.id, lead.phone);
    }
    return map;
  }, []);

  const rows = useMemo<LeadRow[]>(() => {
    return [...campaign.hits]
      .map((hit, idx) => {
        const canal = CANAIS.find((c) => c.id === hit.canal);
        return {
          hitIndex: idx,
          leadId: hit.leadId,
          name: hit.leadName ?? "Visitante anônimo",
          phone: hit.leadId ? phoneByLeadId.get(hit.leadId) ?? "—" : "—",
          canal: hit.canal,
          canalIcon: canal?.icon ?? "🔗",
          canalLabel: canal?.label.split(" (")[0] ?? hit.canal,
          timestamp: hit.timestamp,
          convertido: hit.convertido,
          valor: hit.valor,
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [campaign, phoneByLeadId]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function openInCrm(leadId?: string) {
    if (!leadId) return;
    onNavigate?.();
    navigate({ to: "/crm", search: { lead: leadId } as never });
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground rounded-lg border border-dashed border-border">
        Nenhum clique registrado ainda.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="hidden md:table-cell">Telefone</TableHead>
              <TableHead className="hidden sm:table-cell">Origem</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow key={row.hitIndex}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm truncate max-w-[180px]">{row.name}</span>
                    {row.convertido ? (
                      <Badge variant="default" className="bg-success w-fit mt-0.5 text-[10px] h-4 px-1">
                        Convertido{row.valor ? ` · R$ ${row.valor.toLocaleString("pt-BR")}` : ""}
                      </Badge>
                    ) : row.leadId ? (
                      <Badge variant="secondary" className="w-fit mt-0.5 text-[10px] h-4 px-1">Lead</Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground mt-0.5">Anônimo</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {row.phone !== "—" ? (
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <Phone className="h-3 w-3 text-muted-foreground" />
                      {row.phone}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span>{row.canalIcon}</span>
                    <span className="truncate max-w-[120px]">{row.canalLabel}</span>
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(row.timestamp).toLocaleString("pt-BR", {
                    day: "2-digit", month: "2-digit", year: "2-digit",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!row.leadId}
                    onClick={() => openInCrm(row.leadId)}
                    title={row.leadId ? "Abrir no CRM" : "Sem lead vinculado"}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {rows.length} registro{rows.length !== 1 ? "s" : ""} · página {safePage + 1} de {totalPages}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
