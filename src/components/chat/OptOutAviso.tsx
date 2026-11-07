import { useEffect, useState } from "react";
import { BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { optOutApi } from "@/lib/vpsApi";

// Aviso mínimo na conversa: o paciente pediu SAIR. O admin pode desfazer só a pedido do
// paciente, informando como ele pediu (fica registrado quem desfez e quando).
// Acabamento visual: Davi.
export function OptOutAviso({ leadId }: { leadId: string }) {
  const [info, setInfo] = useState<{ optedOut: boolean; since?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    optOutApi.status(leadId).then(({ data }) => { if (!cancelled) setInfo(data ?? null); });
    return () => { cancelled = true; };
  }, [leadId]);

  if (!info?.optedOut) return null;

  const desfazer = async () => {
    const solicitacao = window.prompt("O paciente pediu para voltar a receber mensagens automáticas? Diga como ele pediu (ex.: por telefone, no balcão, por mensagem nesta conversa):");
    if (!solicitacao || solicitacao.trim().length < 3) return;
    setSaving(true);
    const { error } = await optOutApi.revogar(leadId, solicitacao.trim());
    setSaving(false);
    if (error) { toast.error(error); return; }
    toast.success("Pronto: o paciente volta a receber lembretes e mensagens automáticas.");
    setInfo({ optedOut: false });
  };

  return (
    <div role="status" className="flex items-center gap-2 border-b border-border/60 bg-warning/10 px-4 py-2 text-xs text-foreground">
      <BellOff className="h-3.5 w-3.5 shrink-0 text-warning" />
      <span className="flex-1">
        Este paciente pediu para não receber mensagens automáticas{info.since ? ` (desde ${new Date(info.since).toLocaleDateString("pt-BR")})` : ""}. Lembretes e campanhas não saem; o atendimento pela conversa continua normal.
      </span>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={desfazer} disabled={saving}>
        {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
        Voltar a enviar (a pedido do paciente)
      </Button>
    </div>
  );
}
