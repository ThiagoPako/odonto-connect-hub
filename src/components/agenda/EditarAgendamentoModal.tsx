import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { agendaApi, dentistasApi, type AgendamentoVPS } from "@/lib/vpsApi";

interface Prof { id: string; nome: string }

interface Props {
  appointment: AgendamentoVPS | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

const STATUS_OPTIONS = [
  { value: "agendado", label: "Agendado" },
  { value: "confirmado", label: "Confirmado" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "finalizado", label: "Finalizado" },
  { value: "faltou", label: "Faltou" },
  { value: "cancelado", label: "Cancelado" },
];

export function EditarAgendamentoModal({ appointment, open, onOpenChange, onSaved }: Props) {
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [duracao, setDuracao] = useState(30);
  const [procedimento, setProcedimento] = useState("");
  const [status, setStatus] = useState("agendado");
  const [sala, setSala] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [dentistaId, setDentistaId] = useState("");
  const [profs, setProfs] = useState<Prof[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    dentistasApi.list().then(({ data }) => {
      if (Array.isArray(data)) setProfs(data as Prof[]);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!appointment) return;
    setData(appointment.data || "");
    setHora(appointment.hora || "");
    setDuracao(appointment.duracao || 30);
    setProcedimento(appointment.procedimento || "");
    setStatus(appointment.status || "agendado");
    setSala(appointment.sala || "");
    setObservacoes(appointment.observacoes || "");
    setDentistaId(appointment.dentista_id || "");
  }, [appointment]);

  if (!appointment) return null;

  const handleSave = async () => {
    setSaving(true);
    const dent = profs.find((p) => p.id === dentistaId);
    const { error } = await agendaApi.update(appointment.id, {
      data,
      hora,
      duracao,
      procedimento,
      status,
      sala,
      observacoes,
      dentista_id: dentistaId,
      dentista_nome: dent?.nome,
    });
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error);
    } else {
      toast.success("Agendamento atualizado");
      onSaved();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar agendamento</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">{appointment.paciente_nome}</div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hora</Label>
              <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Duração (min)</Label>
              <Input
                type="number"
                min={5}
                step={5}
                value={duracao}
                onChange={(e) => setDuracao(Number(e.target.value) || 30)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Profissional</Label>
              <Select value={dentistaId} onValueChange={setDentistaId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {profs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Procedimento</Label>
            <Input value={procedimento} onChange={(e) => setProcedimento(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Sala</Label>
            <Input value={sala} onChange={(e) => setSala(e.target.value)} placeholder="Opcional" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              placeholder="Opcional"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
