import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, MessageCircle } from "lucide-react";

/**
 * Pedaço real da interface (agenda do dia) usado na landing e nas telas de
 * entrada. É interativo: a linha "agora" segue o horário de Brasília e clicar
 * numa consulta avança o status, como na agenda do sistema.
 * Os pacientes são EXEMPLOS (não são dados reais). Ver DESIGN.md › Landing.
 */

type Status = "agendado" | "confirmado" | "atendimento" | "finalizado";

const ORDEM: Status[] = ["agendado", "confirmado", "atendimento", "finalizado"];

const ROTULO: Record<Status, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  atendimento: "Em atendimento",
  finalizado: "Finalizado",
};

const ESTILO: Record<Status, string> = {
  agendado: "bg-muted text-muted-foreground",
  confirmado: "bg-accent text-accent-foreground",
  atendimento: "bg-warning/15 text-warning-text",
  finalizado: "bg-success/12 text-success",
};

interface Consulta {
  hora: string; // "08:30"
  paciente: string;
  procedimento: string;
  dentista: string;
  status: Status;
  viaWhatsApp?: boolean;
}

const EXEMPLO: Consulta[] = [
  { hora: "08:00", paciente: "Mariana Costa", procedimento: "Limpeza e profilaxia", dentista: "Dra. Paula", status: "finalizado", viaWhatsApp: true },
  { hora: "09:30", paciente: "Rafael Lima", procedimento: "Avaliação de implante", dentista: "Dr. Henrique", status: "finalizado" },
  { hora: "11:00", paciente: "Beatriz Souza", procedimento: "Restauração em resina", dentista: "Dra. Paula", status: "atendimento", viaWhatsApp: true },
  { hora: "14:00", paciente: "João Pereira", procedimento: "Manutenção ortodôntica", dentista: "Dr. Caio", status: "confirmado", viaWhatsApp: true },
  { hora: "15:30", paciente: "Ana Ribeiro", procedimento: "Clareamento — 2ª sessão", dentista: "Dra. Paula", status: "confirmado", viaWhatsApp: true },
  { hora: "17:00", paciente: "Carlos Mendes", procedimento: "Retorno pós-cirúrgico", dentista: "Dr. Henrique", status: "agendado" },
];

function minutos(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/** Hora atual em Brasília, em minutos desde 00:00. */
function agoraBrasilia(): number {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function AgendaFragment({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const [consultas, setConsultas] = useState(EXEMPLO);
  // null no servidor; preenchido no navegador (evita divergência de hidratação)
  const [agora, setAgora] = useState<number | null>(null);
  const [hoje, setHoje] = useState("Hoje");

  useEffect(() => {
    const tick = () => setAgora(agoraBrasilia());
    tick();
    const id = setInterval(tick, 30_000);
    const d = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });
    setHoje(`Hoje, ${d}`);
    return () => clearInterval(id);
  }, []);

  const resumo = useMemo(() => {
    const c = (s: Status) => consultas.filter((x) => x.status === s).length;
    return { total: consultas.length, confirmadas: c("confirmado"), atendimento: c("atendimento"), finalizadas: c("finalizado") };
  }, [consultas]);

  const avancar = (i: number) =>
    setConsultas((prev) =>
      prev.map((c, j) => (j === i ? { ...c, status: ORDEM[(ORDEM.indexOf(c.status) + 1) % ORDEM.length] } : c)),
    );

  // Onde a linha "agora" entra: antes da primeira consulta que ainda não começou
  const dentroDoExpediente = agora !== null && agora >= minutos("07:30") && agora <= minutos("18:30");
  const indiceAgora = dentroDoExpediente ? consultas.findIndex((c) => minutos(c.hora) > (agora as number)) : -1;
  const horaAgora =
    agora !== null ? `${String(Math.floor(agora / 60)).padStart(2, "0")}:${String(agora % 60).padStart(2, "0")}` : "";

  const linhas = compact ? consultas.slice(1, 5) : consultas;
  const deslocamento = compact ? 1 : 0;

  const LinhaAgora = () => (
    <li aria-hidden="true" className="flex items-center gap-2 px-4 py-0.5">
      <span className="text-xs font-semibold tabular-nums text-destructive w-11">{horaAgora}</span>
      <span className="h-0.5 flex-1 rounded-full bg-destructive/70" />
    </li>
  );

  return (
    <div
      data-ui
      className={`bg-card text-card-foreground rounded-lg border border-border shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] overflow-hidden text-left ${className}`}
    >
      <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-3 border-b border-border">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-semibold leading-tight">Agenda</p>
          <p className="text-[0.8125rem] text-muted-foreground first-letter:uppercase truncate">{hoje}</p>
        </div>
        <div className="flex gap-4 text-right shrink-0" aria-live="polite">
          <div>
            <p className="text-lg font-semibold leading-none tabular-nums">{resumo.total}</p>
            <p className="text-xs text-muted-foreground mt-1">consultas</p>
          </div>
          <div>
            <p className="text-lg font-semibold leading-none tabular-nums text-primary">{resumo.confirmadas}</p>
            <p className="text-xs text-muted-foreground mt-1">confirmadas</p>
          </div>
          {!compact && (
            <div>
              <p className="text-lg font-semibold leading-none tabular-nums">{resumo.finalizadas}</p>
              <p className="text-xs text-muted-foreground mt-1">finalizadas</p>
            </div>
          )}
        </div>
      </div>

      <ul className="py-2">
        {linhas.map((c, k) => {
          const i = k + deslocamento;
          return (
            <FragmentRow key={c.hora}>
              {indiceAgora === i && <LinhaAgora />}
              <li>
                <button
                  type="button"
                  onClick={() => avancar(i)}
                  className="group w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/70 focus-visible:bg-muted/70 transition-colors"
                  aria-label={`${c.hora}, ${c.paciente}, ${ROTULO[c.status]}. Clique para avançar o status.`}
                >
                  <span className="text-[0.8125rem] font-medium tabular-nums text-muted-foreground w-11 shrink-0">{c.hora}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[0.875rem] font-medium leading-tight truncate">{c.paciente}</span>
                    <span className="block text-xs text-muted-foreground leading-tight truncate mt-0.5">
                      {c.procedimento} · {c.dentista}
                    </span>
                  </span>
                  {c.viaWhatsApp && c.status === "confirmado" && !compact && (
                    <MessageCircle className="hidden sm:block h-3.5 w-3.5 text-success shrink-0" aria-label="Confirmado pelo WhatsApp" />
                  )}
                  <span className={`inline-flex items-center gap-1 min-h-6 py-0.5 px-2 rounded text-xs font-semibold shrink-0 ${ESTILO[c.status]}`}>
                    {c.status === "finalizado" && <Check className="h-3 w-3" aria-hidden="true" />}
                    {ROTULO[c.status]}
                  </span>
                </button>
              </li>
            </FragmentRow>
          );
        })}
        {dentroDoExpediente && indiceAgora === -1 && <LinhaAgora />}
      </ul>

      {!compact && (
        <p className="px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
          Toque numa consulta para mudar o status · pacientes de exemplo
        </p>
      )}
    </div>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
