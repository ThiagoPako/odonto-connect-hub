import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVpsEvent } from "@/hooks/useVpsEvent";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ChevronLeft, ChevronRight, Settings, RefreshCw, Clock, Database, Send, SlidersHorizontal, Users } from "lucide-react";
import { toast } from "sonner";
import { agendaApi, dentistasApi, clinicaApi, type AgendamentoVPS, type ClinicaConfig } from "@/lib/vpsApi";
import { clinicorpApi } from "@/lib/clinicorpApi";
import { AgendaMiniCalendar } from "@/components/agenda/AgendaMiniCalendar";
import { AgendaProfessionalsList } from "@/components/agenda/AgendaProfessionalsList";
import { AgendaGrid } from "@/components/agenda/AgendaGrid";
import { NovoAgendamentoModal } from "@/components/agenda/NovoAgendamentoModal";
import { AgendamentoPopover } from "@/components/agenda/AgendamentoPopover";
import { AgendaStatusFilter } from "@/components/agenda/AgendaStatusFilter";
import { ListaEsperaDialog } from "@/components/agenda/ListaEsperaDialog";
import { STATUS_OPTIONS as AGENDA_STATUS_OPTIONS, UNCONFIRMED_STATUSES } from "@/components/agenda/agendaStatus";
import { cn } from "@/lib/utils";
import { usePodeAcessar } from "@/hooks/usePodeAcessar";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/agenda")({
  ssr: false,
  component: AgendaPage,
});

interface Prof { id: string; nome: string; especialidade?: string | null; cor?: string | null }

const DAYS_PT = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DOW_KEYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

function fmtDateBR(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Mesma lista da tela Configurações > Agenda
const INTERVALOS = [5, 15, 20, 30, 60];
const INTERVALO_SESSION_KEY = "agenda:intervalo";

/**
 * Troca mensagens técnicas (HTTP 502, "VPS"...) por um texto para a recepção.
 * "Tente de novo" só quando esperar resolve (servidor fora, limite, rede).
 * Erro de configuração/validação (4xx) mostra o motivo do servidor.
 */
function clinicorpErrorMessage(err: unknown): string {
  const e = err as { message?: string; status?: number } | null;
  const status = typeof e?.status === "number" ? e.status : 0;
  const msg = e?.message?.trim() || "";
  const falhaRede = err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(msg);
  if (falhaRede || status >= 500 || status === 429) {
    return "Não foi possível falar com o Clinicorp agora. Tente de novo em alguns minutos.";
  }
  const semTexto = !msg || /^HTTP \d+$/i.test(msg);
  if (semTexto) {
    return "O Clinicorp recusou o pedido. Verifique a integração em Configurações > Integrações.";
  }
  return `Clinicorp: ${msg}`;
}

function AgendaPage() {
  const podeAcessar = usePodeAcessar();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [profs, setProfs] = useState<Prof[]>([]);
  const [listaEsperaOpen, setListaEsperaOpen] = useState(false);
  const [selectedProfs, setSelectedProfs] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(AGENDA_STATUS_OPTIONS.map((s) => s.id));
  const [appointments, setAppointments] = useState<AgendamentoVPS[]>([]);
  const [config, setConfig] = useState<ClinicaConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNovo, setShowNovo] = useState(false);
  const [novoDefaults, setNovoDefaults] = useState<{ hora?: string; dentistaId?: string }>({});
  const [popoverApt, setPopoverApt] = useState<AgendamentoVPS | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReprojecting, setIsReprojecting] = useState(false);
  const [clinicorpAtivo, setClinicorpAtivo] = useState(false);
  const [showFiltros, setShowFiltros] = useState(false);

  // "Buscar do Clinicorp" usa as credenciais do próprio usuário (/sync/now é
  // por usuário). "Atualizar agenda" é por clínica e continua sempre visível,
  // porque ainda não existe um sinal de "clínica tem Clinicorp".
  useEffect(() => {
    let cancel = false;
    clinicorpApi.getMySettings()
      .then((s) => { if (!cancel) setClinicorpAtivo(!!s?.enabled); })
      .catch(() => { if (!cancel) setClinicorpAtivo(false); });
    return () => { cancel = true; };
  }, []);

  // Load profs + config
  useEffect(() => {
    dentistasApi.list()
      .then(({ data, error }) => {
        if (error) {
          toast.error("Não foi possível carregar os profissionais: " + error);
          return;
        }
        if (Array.isArray(data)) {
          const list = (data as Prof[]).filter((p) => p?.id);
          setProfs(list);
          setSelectedProfs((prev) => Array.from(new Set([...prev, ...list.map((p) => p.id)])));
        }
      })
    clinicaApi.getConfig()
      .then(({ data, error }) => {
        if (error) {
          toast.error("Não foi possível carregar o horário da clínica (usando 08:00–19:00): " + error);
          return;
        }
        if (data) setConfig(data);
      });
  }, []);

  // Load appointments for current date
  const dateStr = toISO(currentDate);
  const currentDateRef = useRef(dateStr);
  currentDateRef.current = dateStr;
  const loadAppointments = () => {
    const requested = dateStr;
    setLoading(true);
    agendaApi.list({ data_inicio: requested, data_fim: requested })
      .then(({ data, error }) => {
        if (requested !== currentDateRef.current) return;
        if (error) {
          // Não deixa na tela os agendamentos de outro dia
          setAppointments([]);
          setLoadError(error);
          toast.error("Erro ao carregar agenda: " + error);
          return;
        }
        setLoadError(null);
        if (Array.isArray(data)) {
          setAppointments(data);
          setProfs((current) => {
            const merged = new Map<string, Prof>();
            for (const p of current) merged.set(p.id, p);
            let hasUnassigned = false;
            for (const apt of data) {
              if (apt.dentista_id) {
                if (!merged.has(apt.dentista_id)) {
                  merged.set(apt.dentista_id, {
                    id: apt.dentista_id,
                    nome: apt.dentista_nome || "Profissional Clinicorp",
                  });
                }
              } else {
                hasUnassigned = true;
              }
            }
            if (hasUnassigned && !merged.has("__sem_dentista__")) {
              merged.set("__sem_dentista__", { id: "__sem_dentista__", nome: "Sem profissional" });
            }
            const added = Array.from(merged.keys()).filter((id) => !current.some((p) => p.id === id));
            if (added.length) setSelectedProfs((prev) => Array.from(new Set([...prev, ...added])));
            return Array.from(merged.values());
          });
          // Normaliza appointments sem dentista_id para a coluna "Sem profissional"
          setAppointments(data.map((a) => a.dentista_id ? a : { ...a, dentista_id: "__sem_dentista__" }));
        }
      })
      .finally(() => setLoading(false));
  };
  useEffect(loadAppointments, [dateStr]);
  
  // Tempo real: a VPS emite agendamento_changed só para a clínica do usuário
  const loadRef = useRef(loadAppointments);
  loadRef.current = loadAppointments;
  useVpsEvent<{ data?: string }>("agendamento_changed", (evt) => {
    if (!evt?.data || evt.data === currentDateRef.current) loadRef.current();
  });


  // Horário do dia atual com base na config
  const { inicio, fim } = useMemo(() => {
    if (!config) return { inicio: "08:00", fim: "19:00" };
    const dow = DOW_KEYS[currentDate.getDay()];
    const h = config.horarios?.[dow];
    if (!h || !h.ativo) return { inicio: "08:00", fim: "19:00" };
    return { inicio: h.inicio, fim: h.fim };
  }, [config, currentDate]);

  // Ajuste temporário (só nesta aba/sessão). O padrão é o da clínica, definido
  // em Configurações > Agenda. Antes ficava salvo para sempre no navegador.
  const [intervaloOverride, setIntervaloOverride] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      window.localStorage.removeItem(INTERVALO_SESSION_KEY);
      const v = Number(window.sessionStorage.getItem(INTERVALO_SESSION_KEY));
      return v > 0 ? v : null;
    } catch { return null; }
  });
  const intervaloPadrao = config?.intervalo_agenda ?? 30;
  const intervalo = intervaloOverride ?? intervaloPadrao;
  const setIntervalo = (v: number | null) => {
    setIntervaloOverride(v);
    try {
      if (v == null) window.sessionStorage.removeItem(INTERVALO_SESSION_KEY);
      else window.sessionStorage.setItem(INTERVALO_SESSION_KEY, String(v));
    } catch { /* storage indisponível: vale só até recarregar */ }
  };
  const fmtIntervalo = (m: number) => (m < 60 ? `${m} MINUTOS` : "1 HORA");
  const opcoesIntervalo = Array.from(new Set([...INTERVALOS, intervaloPadrao, intervalo])).sort((a, b) => a - b);

  const visibleProfs = profs.filter((p) => selectedProfs.includes(p.id));
  const visibleApts = appointments.filter((a) => {
    const matchProf = !a.dentista_id || selectedProfs.includes(a.dentista_id);
    const matchStatus = selectedStatuses.includes(a.status || "agendado");
    return matchProf && matchStatus;
  });

  const handleCellClick = (profId: string, hora: string) => {
    setNovoDefaults({ hora, dentistaId: profId });
    setShowNovo(true);
  };

  const goPrev = () => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); };
  const goNext = () => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); };
  const goToday = () => setCurrentDate(new Date());

  const handleSyncClinicorp = async () => {
    setIsSyncing(true);
    const toastId = toast.loading("Sincronizando com Clinicorp...");
    try {
      await clinicorpApi.syncMyNow({ force_metadata: true });
      toast.success("Sincronização iniciada em segundo plano!", { id: toastId });
    } catch (err) {
      toast.error(clinicorpErrorMessage(err), { id: toastId });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReproject = async () => {
    setIsReprojecting(true);
    const toastId = toast.loading("Atualizando agenda com os dados já trazidos do Clinicorp...");
    try {
      const result = await clinicorpApi.reproject();
      const ag = result?.appointments ?? 0;
      const pa = result?.patients ?? 0;
      const pr = result?.professionals ?? 0;
      if (ag + pa + pr === 0) {
        toast.info("Nenhum dado do Clinicorp encontrado para esta clínica. Se a clínica usa Clinicorp, use antes \"Buscar do Clinicorp\".", { id: toastId });
        return;
      }
      toast.success(`Agenda atualizada com o Clinicorp: ${ag} agendamentos, ${pa} pacientes e ${pr} profissionais.`, { id: toastId });
      loadAppointments();
      const { data, error } = await dentistasApi.list();
      if (error) toast.error("Não foi possível atualizar os profissionais: " + error);
      else if (Array.isArray(data)) {
        setProfs((current) => {
          const merged = new Map(current.map((p) => [p.id, p] as const));
          for (const p of data) if (p.id) merged.set(p.id, p);
          return Array.from(merged.values());
        });
      }
    } catch (err) {
      toast.error(clinicorpErrorMessage(err), { id: toastId });
    } finally {
      setIsReprojecting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-background/50 animate-fade-in">
      <DashboardHeader title="Agenda" />
      <div className="flex-1 p-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={goPrev} aria-label="Dia anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={goToday}>Hoje</Button>
            <Button size="sm" variant="outline" onClick={goNext} aria-label="Próximo dia"><ChevronRight className="h-4 w-4" /></Button>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="ml-2 gap-2 rounded-xl glass-card">
                  <CalendarIcon className="h-4 w-4 text-primary" />
                  <span className="hidden sm:inline">Selecionar Data</span>
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

            <div className="ml-3">
              <div className="text-base font-semibold text-foreground">
                <span className="font-heading tracking-tight capitalize">{DAYS_PT[currentDate.getDay()]}</span>, <span className="text-muted-foreground/80 font-normal">{fmtDateBR(currentDate)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {visibleApts.length} agendamento(s) · {visibleProfs.length} profissional(is)
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-card/50 glass-card">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <Select
                value={intervaloOverride == null ? "padrao" : String(intervalo)}
                onValueChange={(v) => setIntervalo(v === "padrao" ? null : Number(v))}
              >
                <SelectTrigger aria-label="Tempo de cada linha da agenda" className="min-h-0 h-7 w-auto min-w-[10rem] border-0 shadow-none focus:ring-0 px-1 text-[11px] font-bold uppercase tracking-wider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/40 glass-card">
                  <SelectItem value="padrao" className="text-[11px] font-medium rounded-lg">
                    PADRÃO · {intervaloPadrao < 60 ? `${intervaloPadrao} MIN` : "1 H"}
                  </SelectItem>
                  {opcoesIntervalo.map(m => (
                    <SelectItem key={m} value={String(m)} className="text-[11px] font-medium rounded-lg">
                      {fmtIntervalo(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl glass-card text-[11px] font-bold uppercase tracking-wider"
              onClick={() => setListaEsperaOpen(true)}
            >
              <Users className="h-4 w-4 mr-2 text-primary" />
              Lista de espera
            </Button>
            <ListaEsperaDialog open={listaEsperaOpen} onOpenChange={setListaEsperaOpen} professionals={profs} />
            {clinicorpAtivo && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl glass-card text-[11px] font-bold uppercase tracking-wider"
                  onClick={handleSyncClinicorp}
                  disabled={isSyncing}
                  title="Busca no Clinicorp os agendamentos, pacientes e profissionais mais recentes"
                >
                  <Database className={cn("h-4 w-4 mr-2 text-primary", isSyncing && "animate-spin")} />
                  Buscar do Clinicorp
                </Button>
            )}
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl glass-card text-[11px] font-bold uppercase tracking-wider"
                  onClick={handleReproject}
                  disabled={isReprojecting}
                  title="Atualizar agenda com dados do Clinicorp"
                >
                  <Send className={cn("h-4 w-4 mr-2 text-primary", isReprojecting && "animate-pulse")} />
                  Atualizar agenda com Clinicorp
                </Button>
            <Button size="sm" variant="outline" className="rounded-xl glass-card hover:bg-primary/10 transition-colors" onClick={loadAppointments} disabled={loading} aria-label="Recarregar agenda">
              <RefreshCw className={`h-4 w-4 text-primary ${loading ? "animate-spin" : ""}`} />
            </Button>
            {/* Só admin abre /configuracoes/agenda: para os outros perfis o botão levava a "Acesso negado" */}
            {podeAcessar("/configuracoes/agenda") && (
              <Link to="/configuracoes/agenda">
                <Button size="sm" variant="outline" className="rounded-xl glass-card text-[11px] font-bold uppercase tracking-wider">
                  <Settings className="h-4 w-4 mr-2 text-primary" /> Config
                </Button>
              </Link>
            )}
            <Button size="sm" className="rounded-xl bg-primary shadow-glow-primary hover:scale-[1.02] active:scale-[0.98] transition-all text-[11px] font-bold uppercase tracking-wider" onClick={() => { setNovoDefaults({}); setShowNovo(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Novo
            </Button>
          </div>
        </div>

        {loadError && (
          <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <span>Não foi possível carregar a agenda deste dia. {loadError}</span>
            <Button size="sm" variant="outline" onClick={loadAppointments} disabled={loading}>Tentar de novo</Button>
          </div>
        )}

        <Button
          size="sm"
          variant="outline"
          className="lg:hidden mb-3 w-full justify-center gap-2 rounded-xl glass-card"
          onClick={() => setShowFiltros((v) => !v)}
          aria-expanded={showFiltros}
          aria-controls="agenda-filtros"
        >
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          {showFiltros ? "Esconder filtros" : "Filtros (calendário, status, profissionais)"}
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 lg:gap-6 lg:h-[calc(100vh-220px)]">
          <aside id="agenda-filtros" className={cn("space-y-3 lg:overflow-y-auto", showFiltros ? "block" : "hidden", "lg:block")}>
            <AgendaMiniCalendar currentDate={currentDate} onChange={setCurrentDate} />
            <AgendaStatusFilter 
              selected={selectedStatuses}
              onToggle={(id) => setSelectedStatuses(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])}
              onSelectAll={() => setSelectedStatuses(prev => prev.length === AGENDA_STATUS_OPTIONS.length ? [] : AGENDA_STATUS_OPTIONS.map((s) => s.id))}
              onOnlyUnconfirmed={() => setSelectedStatuses(UNCONFIRMED_STATUSES)}
            />
            <AgendaProfessionalsList
              professionals={profs}
              selected={selectedProfs}
              onToggle={(id) =>
                setSelectedProfs((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])
              }
              onSelectAll={() =>
                setSelectedProfs((prev) => prev.length === profs.length ? [] : profs.map((p) => p.id))
              }
            />
          </aside>

          <div className="flex min-h-0 h-[70vh] lg:h-auto">
          <AgendaGrid
            professionals={visibleProfs}
            appointments={visibleApts}
            intervalo={intervalo}
            inicio={inicio}
            fim={fim}
            onCellClick={handleCellClick}
            onAppointmentClick={(a) => setPopoverApt(a)}
          />
          </div>
        </div>
      </div>

      <NovoAgendamentoModal
        open={showNovo}
        onOpenChange={setShowNovo}
        defaultDate={dateStr}
        defaultHora={novoDefaults.hora}
        defaultDentistaId={novoDefaults.dentistaId}
        onCreated={loadAppointments}
      />

      <AgendamentoPopover
        appointment={popoverApt}
        open={!!popoverApt}
        onOpenChange={(v) => !v && setPopoverApt(null)}
        onChanged={loadAppointments}
      />
    </div>
  );
}
