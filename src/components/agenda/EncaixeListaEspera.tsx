import { useCallback, useEffect, useState } from "react";
import { Loader2, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listaEsperaApi, type EncaixeInfo } from "@/lib/vpsApi";

// Horários liberados (a recepção desmarcou ou cancelou). A oferta só sai pelo
// clique da recepção, para um paciente por vez, pela fila do WhatsApp da clínica.
// "remarcar" não libera: o paciente foi avisado de que o horário continua reservado.
const STATUS_LIBERADOS = new Set(["cancelado", "desmarcado"]);

function horaCurta(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function EncaixeListaEspera({ agendamentoId, status, onChanged }: { agendamentoId: string; status?: string; onChanged?: () => void }) {
  const liberado = STATUS_LIBERADOS.has(status || "");
  const [info, setInfo] = useState<EncaixeInfo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listaEsperaApi.encaixe(agendamentoId);
    setLoading(false);
    if (error) { setErro(error); setInfo(null); return; }
    setErro(null);
    setInfo(data ?? null);
  }, [agendamentoId]);

  useEffect(() => { if (liberado) load(); }, [liberado, load]);

  const liberar = async () => {
    if (!confirm("Você já falou com o paciente? O horário dele será desmarcado e poderá ser oferecido à lista de espera.")) return;
    setSending(true);
    const { error } = await listaEsperaApi.liberarHorario(agendamentoId);
    setSending(false);
    if (error) { toast.error(error); return; }
    toast.success("Horário liberado");
    onChanged?.();
  };

  if (status === "remarcar") {
    return (
      <div className="p-3 border-t border-border/60 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
          <Users className="h-3 w-3" /> Lista de espera
        </div>
        <p className="text-xs text-foreground">
          O paciente pediu para remarcar e foi avisado de que este horário continua reservado. Fale com ele antes de liberar.
        </p>
        <Button size="sm" variant="outline" className="w-full h-8" onClick={liberar} disabled={sending}>
          {sending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Liberar horário (já falei com o paciente)
        </Button>
      </div>
    );
  }

  if (!liberado) return null;

  const oferecer = async () => {
    setSending(true);
    const { data, error } = await listaEsperaApi.oferecer(agendamentoId);
    setSending(false);
    if (error) { toast.error(error); load(); return; }
    toast.success(`Oferta enviada para ${data?.oferta.paciente_nome || "o próximo da lista"}`, {
      description: data?.oferta.expires_at ? `Aguardando resposta até ${horaCurta(data.oferta.expires_at)}` : undefined,
    });
    load();
    onChanged?.();
  };

  return (
    <div className="p-3 border-t border-border/60 space-y-2" aria-live="polite">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
        <Users className="h-3 w-3" /> Lista de espera
      </div>
      {loading && !info && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Consultando…</div>}
      {erro && <div className="text-xs text-destructive">Não foi possível consultar a lista de espera: {erro}</div>}
      {info && !info.futuro && <div className="text-xs text-muted-foreground">Horário muito próximo ou já passou: não dá para oferecer.</div>}
      {info?.oferta?.status === "aceita" && (
        <div className="text-xs text-success">Horário preenchido pela lista de espera ({info.oferta.paciente_nome}).</div>
      )}
      {info?.oferta?.status === "enviada" && (
        <div className="text-xs text-foreground">
          Oferta enviada para <span className="font-medium">{info.oferta.paciente_nome}</span>. Aguardando resposta até {horaCurta(info.oferta.expires_at)}.
        </div>
      )}
      {info && info.futuro && !info.oferta && (
        <>
          <div className="text-xs text-foreground">
            {info.candidatos === 0
              ? "Ninguém na lista de espera para este horário."
              : `Há ${info.candidatos} ${info.candidatos === 1 ? "paciente" : "pacientes"} na lista de espera para este horário.`}
          </div>
          {info.candidatos > 0 && (
            <>
              {info.dentroDaJanela === false && (
                <p className="text-[11px] text-warning">Fora do horário de envio do WhatsApp (seg a sex 8h–20h, sáb 8h–13h).</p>
              )}
              <Button size="sm" className="w-full h-8" onClick={oferecer} disabled={sending || info.dentroDaJanela === false}>
                {sending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                Oferecer horário
              </Button>
              <p className="text-[10px] text-muted-foreground">Vai para um paciente por vez, pelo WhatsApp da clínica, com 2 horas para responder.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
