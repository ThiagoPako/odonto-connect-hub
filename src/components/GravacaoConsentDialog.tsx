/**
 * Consentimento do paciente para gravação e transcrição por IA da consulta.
 *
 * Pedido UMA vez por paciente (fica registrado no backend com data, usuário,
 * versão e texto — LGPD art. 8º §2º). Dado de saúde exige consentimento
 * específico e destacado (art. 11, I) e informação sobre o compartilhamento
 * com terceiros e a transferência internacional (arts. 9º, 33). Recusar não
 * impede o atendimento — só a gravação.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShieldCheck } from "lucide-react";

export const GRAVACAO_CONSENT_VERSION = "1.0";

export const GRAVACAO_CONSENT_TEXT =
  "O paciente foi informado e autoriza: (1) a gravação do áudio das suas consultas nesta clínica; " +
  "(2) a transcrição automática desse áudio por serviço de inteligência artificial (OpenAI, com " +
  "servidores nos Estados Unidos), usada apenas para gerar o relatório clínico, que é revisado pelo " +
  "cirurgião-dentista. O áudio não fica armazenado no sistema: é descartado após a transcrição, e " +
  "apenas o texto revisado integra o prontuário. O provedor de IA não usa o conteúdo para treinar " +
  "modelos. O paciente pode revogar esta autorização a qualquer momento, sem nenhum prejuízo ao " +
  "atendimento (Lei nº 13.709/2018, arts. 8º, 11 e 18).";

interface Props {
  open: boolean;
  pacienteNome?: string;
  saving?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function GravacaoConsentDialog({ open, pacienteNome, saving, onConfirm, onCancel }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Autorização para gravar {pacienteNome ? `— ${pacienteNome}` : ""}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                Antes da primeira gravação, confirme que o paciente foi informado e concorda.
                Isso é pedido só uma vez por paciente.
              </p>
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                {GRAVACAO_CONSENT_TEXT}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Não gravar</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
          >
            {saving ? "Registrando..." : "Paciente autorizou"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
