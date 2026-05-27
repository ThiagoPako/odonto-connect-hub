import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ChevronLeft, ChevronRight, Settings, RefreshCw, Clock, Database, Send } from "lucide-react";
import { toast } from "sonner";
import { agendaApi, dentistasApi, clinicaApi, type AgendamentoVPS, type ClinicaConfig, VPS_API_BASE } from "@/lib/vpsApi";
import { clinicorpApi } from "@/lib/clinicorpApi";
import { supabase } from "@/integrations/supabase/client";
import { AgendaMiniCalendar } from "@/components/agenda/AgendaMiniCalendar";
import { AgendaProfessionalsList } from "@/components/agenda/AgendaProfessionalsList";
import { AgendaGrid } from "@/components/agenda/AgendaGrid";
import { NovoAgendamentoModal } from "@/components/agenda/NovoAgendamentoModal";
import { AgendamentoPopover } from "@/components/agenda/AgendamentoPopover";

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

function AgendaPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [profs, setProfs] = useState<Prof[]>([]);
  const [selectedProfs, setSelectedProfs] = useState<string[]>([]);
  const [appointments, setAppointments] = useState<AgendamentoVPS[]>([]);
  const [config, setConfig] = useState<ClinicaConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNovo, setShowNovo] = useState(false);
  const [novoDefaults, setNovoDefaults] = useState<{ hora?: string; dentistaId?: string }>({});
  const [popoverApt, setPopoverApt] = useState<AgendamentoVPS | null>(null);

  // Load profs + config
  useEffect(() => {
    dentistasApi.list()
      .then(({ data }) => {
        if (Array.isArray(data)) {
          const list = (data as Prof[]).filter((p) => p?.id);
          setProfs(list);
          setSelectedProfs(list.map((p) => p.id));
        }
      })
      .catch((err) => console.error("[agenda] dentistas:", err));
    clinicaApi.getConfig()
      .then(({ data }) => data && setConfig(data))
      .catch((err) => console.error("[agenda] config:", err));
  }, []);

  // Load appointments for current date
  const dateStr = toISO(currentDate);
  const loadAppointments = () => {
    setLoading(true);
    agendaApi.list({ data_inicio: dateStr, data_fim: dateStr })
      .then(({ data, error }) => {
        if (error) toast.error("Erro ao carregar agenda: " + error);
        else if (Array.isArray(data)) {
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
            const list = Array.from(merged.values());
            setSelectedProfs((prev) => (prev.length ? prev : list.map((p) => p.id)));
            return list;
          });
          // Normaliza appointments sem dentista_id para a coluna "Sem profissional"
          setAppointments(data.map((a) => a.dentista_id ? a : { ...a, dentista_id: "__sem_dentista__" }));
        }
      })
      .finally(() => setLoading(false));
  };
  useEffect(loadAppointments, [dateStr]);
  
  // Real-time synchronization
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;

    async function connect() {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      if (!token) return;

      try {
        const base = VPS_API_BASE.startsWith("http")
          ? VPS_API_BASE
          : `${window.location.origin}${VPS_API_BASE}`;
        const url = new URL(`${base}/events`);
        url.searchParams.set("token", token);

        es = new EventSource(url.toString());
      } catch (err) {
        console.error("[agenda] SSE connect failed:", err);
        return;
      }

      
      es.addEventListener("agendamento_changed", () => {
        loadAppointments();
      });

      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, [dateStr]); // Re-connect if needed, or just stay connected


  // Horário do dia atual com base na config
  const { inicio, fim } = useMemo(() => {
    if (!config) return { inicio: "08:00", fim: "19:00" };
    const dow = DOW_KEYS[currentDate.getDay()];
    const h = config.horarios?.[dow];
    if (!h || !h.ativo) return { inicio: "08:00", fim: "19:00" };
    return { inicio: h.inicio, fim: h.fim };
  }, [config, currentDate]);

  const [intervaloOverride, setIntervaloOverride] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem("agenda:intervalo");
    return v ? Number(v) : null;
  });
  const intervalo = intervaloOverride ?? config?.intervalo_agenda ?? 30;
  const setIntervalo = (v: number) => {
    setIntervaloOverride(v);
    try { window.localStorage.setItem("agenda:intervalo", String(v)); } catch {}
  };

  const visibleProfs = profs.filter((p) => selectedProfs.includes(p.id));
  const visibleApts = appointments.filter((a) => !a.dentista_id || selectedProfs.includes(a.dentista_id));

  const handleCellClick = (profId: string, hora: string) => {
    setNovoDefaults({ hora, dentistaId: profId });
    setShowNovo(true);
  };

  const goPrev = () => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); };
  const goNext = () => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); };
  const goToday = () => setCurrentDate(new Date());

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-background/50 animate-fade-in">
      <DashboardHeader title="Agenda" />
      <main className="flex-1 p-4 overflow-hidden">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={goPrev}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={goToday}>Hoje</Button>
            <Button size="sm" variant="outline" onClick={goNext}><ChevronRight className="h-4 w-4" /></Button>
            <div className="ml-3">
              <div className="text-base font-semibold text-foreground">
                <span className="font-heading tracking-tight">{DAYS_PT[currentDate.getDay()]}</span>, <span className="text-muted-foreground/80 font-normal">{fmtDateBR(currentDate)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {visibleApts.length} agendamento(s) · intervalo {intervalo}min
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border bg-card/50 glass-card">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <Select value={String(intervalo)} onValueChange={(v) => setIntervalo(Number(v))}>
                <SelectTrigger className="h-7 w-[100px] border-0 shadow-none focus:ring-0 px-1 text-[11px] font-bold uppercase tracking-wider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/40 glass-card">
                  {[5, 10, 15, 20, 30, 45, 60].map(m => (
                    <SelectItem key={m} value={String(m)} className="text-[11px] font-medium rounded-lg">
                      {m < 60 ? `${m} MINUTOS` : "1 HORA"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl glass-card hover:bg-primary/10 transition-colors" onClick={loadAppointments} disabled={loading}>
              <RefreshCw className={`h-4 w-4 text-primary ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Link to="/configuracoes/agenda">
              <Button size="sm" variant="outline" className="rounded-xl glass-card text-[11px] font-bold uppercase tracking-wider">
                <Settings className="h-4 w-4 mr-2 text-primary" /> Config
              </Button>
            </Link>
            <Button size="sm" className="rounded-xl bg-primary shadow-glow-primary hover:scale-[1.02] active:scale-[0.98] transition-all text-[11px] font-bold uppercase tracking-wider" onClick={() => { setNovoDefaults({}); setShowNovo(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Novo
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 h-[calc(100vh-220px)]">
          <aside className="space-y-3 overflow-y-auto">
            <AgendaMiniCalendar currentDate={currentDate} onChange={setCurrentDate} />
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
      </main>

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
