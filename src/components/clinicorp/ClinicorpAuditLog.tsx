import { useState, useEffect } from "react";
import { 
  History, 
  ArrowUpRight, 
  ArrowDownRight, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Clock,
  Search,
  Filter
} from "lucide-react";
import { clinicorpApi, type ClinicorpAuditEntry } from "@/lib/clinicorpApi";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export function ClinicorpAuditLog() {
  const [logs, setLogs] = useState<ClinicorpAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "clinicorp" | "odonto_connect">("all");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    try {
      setLoading(true);
      const data = await clinicorpApi.listAuditLogs(200);
      setLogs(data);
    } catch (err) {
      console.error("Failed to load audit logs", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = logs.filter(log => {
    const sourceMatch = filter === "all" || log.source === filter;
    const searchMatch = !searchTerm || 
      log.event.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.target_id && log.target_id.includes(searchTerm)) ||
      (log.error_message && log.error_message.toLowerCase().includes(searchTerm.toLowerCase()));
    return sourceMatch && searchMatch;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Log de Auditoria e Espelhamento</h3>
        </div>
        
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar por evento ou ID..." 
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Fonte" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Fontes</SelectItem>
              <SelectItem value="clinicorp">Clinicorp (Entrada)</SelectItem>
              <SelectItem value="odonto_connect">Odonto Connect (Saída)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="p-4 font-semibold">Data/Hora</th>
                <th className="p-4 font-semibold">Fonte</th>
                <th className="p-4 font-semibold">Evento</th>
                <th className="p-4 font-semibold">ID Alvo</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="p-8 text-center bg-muted/10 h-12"></td>
                  </tr>
                ))
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-muted-foreground">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={`${log.source}-${log.id}`} className="hover:bg-muted/30 transition-colors">
                    <td className="p-4 whitespace-nowrap text-muted-foreground">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {format(new Date(log.timestamp), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </span>
                        <span className="text-[10px] flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {format(new Date(log.timestamp), "HH:mm:ss")}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      {log.source === 'clinicorp' ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1 font-bold">
                          <ArrowDownRight className="h-3 w-3" /> Clinicorp
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1 font-bold">
                          <ArrowUpRight className="h-3 w-3" /> Odonto Connect
                        </Badge>
                      )}
                    </td>
                    <td className="p-4">
                      <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">
                        {log.event}
                      </code>
                    </td>
                    <td className="p-4 font-mono text-xs text-muted-foreground">
                      {log.target_id || "-"}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5">
                        {log.status === 'processed' || log.status === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : log.status === 'error' ? (
                          <XCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-warning" />
                        )}
                        <span className="capitalize">{log.status}</span>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      {log.error_message && (
                        <button 
                          onClick={() => alert(log.error_message)}
                          className="text-xs text-destructive hover:underline"
                        >
                          Ver Erro
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
