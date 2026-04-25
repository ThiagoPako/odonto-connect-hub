import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { CheckCircle2, Clock, UserCheck, XCircle, Phone, FileText, Edit3, Trash2, MessageCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { agendaApi, type AgendamentoVPS } from "@/lib/vpsApi";
import { EditarAgendamentoModal } from "./EditarAgendamentoModal";

interface Props {
  appointment: AgendamentoVPS | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
  anchorRect?: DOMRect | null;
}

const STATUS_OPTIONS: { value: string; label: string; icon: React.ElementType; color: string }[] = [
  { value: "agendado", label: "Agendado", icon: Clock, color: "text-primary" },
  { value: "confirmado", label: "Confirmado", icon: CheckCircle2, color: "text-success" },
  { value: "em_atendimento", label: "Em atendimento", icon: UserCheck, color: "text-primary" },
  { value: "finalizado", label: "Finalizado", icon: CheckCircle2, color: "text-muted-foreground" },
  { value: "faltou", label: "Faltou", icon: XCircle, color: "text-destructive" },
  { value: "cancelado", label: "Cancelado", icon: XCircle, color: "text-destructive" },
];

export function AgendamentoPopover({ appointment, open, onOpenChange, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  if (!appointment) return null;

  const handleStatusChange = async (status: string) => {
    setSaving(true);
    const { error } = await agendaApi.update(appointment.id, { status });
    setSaving(false);
    if (error) toast.error("Erro: " + error);
    else { toast.success("Status atualizado"); onChanged(); }
  };

  const handleDelete = async (serie = false) => {
    const { error } = await agendaApi.delete(appointment.id, serie ? { serie: true } : undefined);
    if (error) toast.error("Erro ao excluir: " + error);
    else { toast.success(serie ? "Série excluída" : "Agendamento excluído"); onChanged(); onOpenChange(false); }
  };

  const wppLink = appointment.telefone
    ? `https://wa.me/${appointment.telefone.replace(/\D/g, "")}`
    : null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <span className="hidden" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" side="right">
        <div className="p-3 border-b border-border/60">
          <div className="font-medium text-sm">{appointment.paciente_nome || appointment.evento_titulo}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {appointment.data} · {appointment.hora} · {appointment.duracao}min
          </div>
          {appointment.dentista_nome && (
            <div className="text-xs text-muted-foreground mt-0.5">{appointment.dentista_nome}</div>
          )}
          {appointment.serie_id && (
            <Badge variant="outline" className="mt-2 text-[10px]">Parte de uma série</Badge>
          )}
          {Array.isArray(appointment.marcadores) && appointment.marcadores.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {appointment.marcadores.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border"
                  style={{ backgroundColor: m.cor + "22", borderColor: m.cor + "55", color: m.cor }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.cor }} />
                  {m.nome}
                </span>
              ))}
            </div>
          )}
          {appointment.como_conheceu && (
            <div className="mt-2 text-[10px] text-muted-foreground">
              Origem: <span className="font-medium text-foreground capitalize">{appointment.como_conheceu}</span>
            </div>
          )}
        </div>

        <div className="p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Status</div>
          <div className="grid grid-cols-2 gap-1.5">
            {STATUS_OPTIONS.map((s) => {
              const Icon = s.icon;
              const active = appointment.status === s.value;
              return (
                <button
                  key={s.value}
                  onClick={() => handleStatusChange(s.value)}
                  disabled={saving || active}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs border ${
                    active
                      ? "bg-primary/10 border-primary text-primary"
                      : "border-border/60 hover:bg-muted text-foreground"
                  }`}
                >
                  <Icon className={`h-3 w-3 ${active ? "" : s.color}`} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-3 border-t border-border/60 space-y-1.5">
          {appointment.telefone && (
            <div className="flex items-center gap-2 text-xs text-foreground">
              <Phone className="h-3 w-3 text-muted-foreground" />
              {appointment.telefone}
              {wppLink && (
                <a href={wppLink} target="_blank" rel="noopener noreferrer" className="ml-auto">
                  <Button size="sm" variant="ghost" className="h-7 px-2">
                    <MessageCircle className="h-3 w-3 mr-1 text-success" /> WhatsApp
                  </Button>
                </a>
              )}
            </div>
          )}
          {appointment.paciente_id && (
            <Button asChild size="sm" variant="outline" className="w-full justify-start h-8">
              <a href={`/prontuario?id=${appointment.paciente_id}`}>
                <FileText className="h-3 w-3 mr-2" /> Abrir prontuário
              </a>
            </Button>
          )}
        </div>

        <div className="p-3 border-t border-border/60 flex items-center gap-2">
          <Button size="sm" variant="outline" className="flex-1 h-8" disabled>
            <Edit3 className="h-3 w-3 mr-1" /> Editar
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" className="h-8">
                <Trash2 className="h-3 w-3" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação não pode ser desfeita.
                  {appointment.serie_id && " Este agendamento faz parte de uma série."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                {appointment.serie_id && (
                  <AlertDialogAction onClick={() => handleDelete(true)} className="bg-destructive text-destructive-foreground">
                    Excluir toda a série
                  </AlertDialogAction>
                )}
                <AlertDialogAction onClick={() => handleDelete(false)} className="bg-destructive text-destructive-foreground">
                  {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                  Excluir só este
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </PopoverContent>
    </Popover>
  );
}
