import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export interface SaasFilterState {
  periodo: string;
  plano: string;
  statusAssinatura: string;
}

interface Props {
  filters: SaasFilterState;
  onChange: (f: SaasFilterState) => void;
  planos: { id: string; nome: string }[];
  onRefresh: () => void;
  loading?: boolean;
}

const SaasFilters = ({ filters, onChange, planos, onRefresh, loading }: Props) => {
  const set = (key: keyof SaasFilterState, val: string) => onChange({ ...filters, [key]: val });

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6 p-3 bg-card rounded-xl border border-border/60 shadow-sm">
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Período</label>
        <Select value={filters.periodo} onValueChange={(v) => set("periodo", v)}>
          <SelectTrigger className="w-[150px] h-9 bg-background"><SelectValue placeholder="Período" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mes_atual">Mês Atual</SelectItem>
            <SelectItem value="3_meses">Últimos 3 Meses</SelectItem>
            <SelectItem value="6_meses">Últimos 6 Meses</SelectItem>
            <SelectItem value="ano">Ano</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Plano</label>
        <Select value={filters.plano} onValueChange={(v) => set("plano", v)}>
          <SelectTrigger className="w-[150px] h-9 bg-background"><SelectValue placeholder="Plano" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os Planos</SelectItem>
            {planos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Status</label>
        <Select value={filters.statusAssinatura} onValueChange={(v) => set("statusAssinatura", v)}>
          <SelectTrigger className="w-[130px] h-9 bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="active">Ativo</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="suspended">Suspenso</SelectItem>
            <SelectItem value="canceled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="ml-auto h-9 px-4 gap-2">
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> 
        <span className="hidden sm:inline">Atualizar Dados</span>
      </Button>
    </div>
  );
};

export default SaasFilters;