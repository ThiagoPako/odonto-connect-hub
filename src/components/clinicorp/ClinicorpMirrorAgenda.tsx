import { useState, useEffect, useMemo } from "react";
import { clinicorpApi } from "@/lib/clinicorpApi";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Clock, User2, CalendarDays, RefreshCw, AlertCircle, PlayCircle, Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

export function ClinicorpMirrorAgenda({ refreshTrigger = 0 }: { refreshTrigger?: number }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<any[]>([]);
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [chairs, setChairs] = useState<any[]>([]);
  const [selectedProfId, setSelectedProfId] = useState<string>("all");
  const [selectedChairId, setSelectedChairId] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingThisDay, setSyncingThisDay] = useState(false);

  const [autoJumped, setAutoJumped] = useState(false);
  const dateStr = format(currentDate, "yyyy-MM-dd");

  useEffect(() => {
    clinicorpApi.listProfessionals().then(setProfessionals).catch(console.error);
    clinicorpApi.listChairs().then(setChairs).catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    clinicorpApi.listAppointments({ from: dateStr, to: dateStr })
      .then(async (rows) => {
        setAppointments(rows);
        // Auto-jump: na primeira carga, se não houver nada hoje, ir para o dia mais próximo com dados.
        if (!autoJumped && rows.length === 0) {
          setAutoJumped(true);
          try {
            const all = await clinicorpApi.listAppointments({ from: '2020-01-01', to: '2030-12-31' });
            if (all.length > 0) {
              const today = new Date(dateStr).getTime();
              const sorted = [...all].sort((a: any, b: any) => {
                const da = Math.abs(new Date(String(a.date).slice(0, 10)).getTime() - today);
                const db = Math.abs(new Date(String(b.date).slice(0, 10)).getTime() - today);
                return da - db;
              });
              const nearest = String((sorted[0] as any).date).slice(0, 10);
              if (nearest !== dateStr) {
                setCurrentDate(new Date(nearest + 'T12:00:00'));
                return;
              }
            }
          } catch (e) { console.error(e); }
        }
      })
      .catch((err) => {
        console.error(err);
        setError(err.message || "Erro ao carregar agendamentos");
      })
      .finally(() => setLoading(false));
  }, [dateStr, refreshTrigger]);

  const filteredAppointments = useMemo(() => {
    return appointments.filter(a => {
      const matchProf = selectedProfId === "all" || String(a.professional_id) === selectedProfId;
      const matchChair = selectedChairId === "all" || String(a.chair_id) === selectedChairId;
      const matchStatus = selectedStatus === "all" || String(a.status).toLowerCase() === selectedStatus.toLowerCase();
      return matchProf && matchChair && matchStatus;
    });
  }, [appointments, selectedProfId, selectedChairId, selectedStatus]);

  const goPrev = () => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); };
  const goNext = () => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); };
  const goToday = () => setCurrentDate(new Date());

  const handleSyncThisDay = async () => {
    setSyncingThisDay(true);
    try {
      const result = await clinicorpApi.syncMyNow({ from: dateStr, to: dateStr });
      toast.success(`Sincronizado: ${result.summary.appointments || 0} agendamentos encontrados para este dia.`);
      // Recarregar os dados do mirror
      clinicorpApi.listAppointments({ from: dateStr, to: dateStr }).then(setAppointments);
    } catch (err: any) {
      toast.error(err.message || "Erro ao sincronizar dia");
    } finally {
      setSyncingThisDay(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={goPrev}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={goToday}>Hoje</Button>
          <Button size="sm" variant="outline" onClick={goNext}><ChevronRight className="h-4 w-4" /></Button>
          
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4 text-primary" />
                <span className="hidden sm:inline">Trocar Data</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 border-none shadow-2xl glass-card rounded-2xl" align="start">
              <Calendar
                mode="single"
                selected={currentDate}
                onSelect={(d) => d && setCurrentDate(d)}
                initialFocus
                locale={ptBR}
              />
            </PopoverContent>
          </Popover>

          <div className="ml-2 flex flex-col">
            <span className="font-semibold text-sm">
              {currentDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
            </span>
            {!loading && !error && (
              <span className="text-[10px] text-muted-foreground">
                {filteredAppointments.length} registro(s) encontrado(s)
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedProfId} onValueChange={setSelectedProfId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Profissional" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Profissionais</SelectItem>
              {professionals.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>{p.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedChairId} onValueChange={setSelectedChairId}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Cadeira/Sala" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Cadeiras</SelectItem>
              {chairs.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              <SelectItem value="agendado">Agendado</SelectItem>
              <SelectItem value="confirmado">Confirmado</SelectItem>
              <SelectItem value="faltou">Faltou</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
              <SelectItem value="em atendimento">Em atendimento</SelectItem>
              <SelectItem value="finalizado">Finalizado</SelectItem>
            </SelectContent>
          </Select>

          <Button 
            size="sm" 
            variant="default" 
            className="bg-primary hover:bg-primary/90 text-white font-bold gap-2"
            onClick={async () => {
              const loadingToast = toast.loading("Sincronizando espelho com a agenda principal...");
              try {
                const r = await clinicorpApi.reproject();
                toast.dismiss(loadingToast);
                toast.success(`Sucesso! ${r.appointments} agendamentos e ${r.patients} pacientes enviados.`);
              } catch (e: any) {
                toast.dismiss(loadingToast);
                toast.error(e.message || "Erro ao enviar dados");
              }
            }}
          >
            <PlayCircle className="h-4 w-4" />
            Enviar dados
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-20 text-center text-muted-foreground animate-pulse flex flex-col items-center gap-2">
            <RefreshCw className="h-8 w-8 animate-spin text-primary/40" />
            Carregando agenda...
          </div>
        ) : error ? (
          <div className="p-20 text-center space-y-4">
            <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="h-8 w-8 text-red-500" />
            </div>
            <div className="space-y-1">
              <div className="text-red-600 font-semibold">Erro na Sincronização</div>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                {error}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()} className="rounded-xl">
              Tentar Novamente
            </Button>
          </div>
        ) : filteredAppointments.length === 0 ? (
          <div className="p-20 text-center space-y-4">
            <div className="bg-muted/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
              <CalendarDays className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground font-medium">Nenhum agendamento para este dia.</div>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                Se você sabe que existem dados na Clinicorp para este dia, clique abaixo para forçar uma busca específica.
              </p>
            </div>
            <Button 
              size="sm" 
              className="rounded-xl gap-2" 
              onClick={handleSyncThisDay}
              disabled={syncingThisDay}
            >
              {syncingThisDay ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {syncingThisDay ? "Sincronizando..." : "Sincronizar este dia agora"}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredAppointments.sort((a,b) => (a.from_time || "").localeCompare(b.from_time || "")).map((a) => (

              <div key={a.id} className="p-4 flex items-start gap-4 hover:bg-muted/30 transition-colors group">
                <div className="w-16 shrink-0 text-center">
                  <div className="text-sm font-bold text-primary">{a.from_time}</div>
                  <div className="text-[10px] text-muted-foreground">{a.to_time}</div>
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold truncate text-foreground group-hover:text-primary transition-colors">
                      {a.patient_name || 'Paciente sem nome'}
                    </h4>
                    <div 
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-sm"
                      style={{ backgroundColor: a.category_color || '#999' }}
                    >
                      {a.category_description || 'Geral'}
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User2 className="h-3 w-3" />
                      <span>{a.professional_name}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span className="capitalize">{a.status}</span>
                    </div>
                  </div>

                  {a.notes && (
                    <p className="mt-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded-lg italic">
                      "{a.notes}"
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
