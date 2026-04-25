import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ChevronLeft, ChevronRight, Settings, RefreshCw, Clock } from "lucide-react";
import { toast } from "sonner";
import { agendaApi, dentistasApi, clinicaApi, type AgendamentoVPS, type ClinicaConfig } from "@/lib/vpsApi";
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
        else if (Array.isArray(data)) setAppointments(data);
      })
      .finally(() => setLoading(false));
  };
  useEffect(loadAppointments, [dateStr]);

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
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Agenda" />
      <main className="flex-1 p-4 overflow-hidden">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={goPrev}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={goToday}>Hoje</Button>
            <Button size="sm" variant="outline" onClick={goNext}><ChevronRight className="h-4 w-4" /></Button>
            <div className="ml-3">
              <div className="text-base font-semibold text-foreground">
                {DAYS_PT[currentDate.getDay()]}, {fmtDateBR(currentDate)}
              </div>
              <div className="text-xs text-muted-foreground">
                {visibleApts.length} agendamento(s) · intervalo {intervalo}min
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border bg-background">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={String(intervalo)} onValueChange={(v) => setIntervalo(Number(v))}>
                <SelectTrigger className="h-7 w-[110px] border-0 shadow-none focus:ring-0 px-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 minutos</SelectItem>
                  <SelectItem value="10">10 minutos</SelectItem>
                  <SelectItem value="15">15 minutos</SelectItem>
                  <SelectItem value="20">20 minutos</SelectItem>
                  <SelectItem value="30">30 minutos</SelectItem>
                  <SelectItem value="45">45 minutos</SelectItem>
                  <SelectItem value="60">1 hora</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={loadAppointments} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Link to="/configuracoes/agenda">
              <Button size="sm" variant="outline"><Settings className="h-4 w-4 mr-1" /> Config</Button>
            </Link>
            <Button size="sm" onClick={() => { setNovoDefaults({}); setShowNovo(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Novo
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-200px)]">
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
