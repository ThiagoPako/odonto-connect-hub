import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Stethoscope, Trash2 } from "lucide-react";
import { tratamentosApi, type PainelTratamento } from "@/lib/vpsApi";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pacienteId: string;
  pacienteNome: string;
  dentistaId: string;
  /** Tratamento existente — quando informado, abre em modo edição */
  tratamento?: PainelTratamento | null;
  onSaved: () => void;
}

const STATUS_OPTIONS = [
  { value: "planejado", label: "Planejado" },
  { value: "em_andamento", label: "Em Andamento" },
  { value: "pausado", label: "Pausado" },
  { value: "finalizado", label: "Finalizado" },
];

export function TratamentoFromAgendaDialog({
  open, onOpenChange, pacienteId, pacienteNome, dentistaId, tratamento, onSaved,
}: Props) {
  const isEdit = !!tratamento;
  const [descricao, setDescricao] = useState("");
  const [dente, setDente] = useState("");
  const [valor, setValor] = useState("0");
  const [status, setStatus] = useState("planejado");
  const [plano, setPlano] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setDescricao(tratamento?.descricao || "");
      setDente(tratamento?.dente || "");
      setValor(String(tratamento?.valor ?? 0));
      setStatus(tratamento?.status || "planejado");
      setPlano(tratamento?.plano || "");
      setObservacoes(tratamento?.observacoes || "");
    }
  }, [open, tratamento]);

  const handleSave = async () => {
    if (!descricao.trim()) {
      toast.error("Informe a descrição do tratamento");
      return;
    }
    setSaving(true);
    const payload = {
      paciente_id: pacienteId,
      dentista_id: dentistaId,
      descricao: descricao.trim(),
      dente: dente.trim(),
      valor: Number(valor) || 0,
      status,
      plano: plano.trim(),
      observacoes: observacoes.trim(),
    };
    const { error } = isEdit
      ? await tratamentosApi.update(tratamento!.id, payload)
      : await tratamentosApi.create(payload);
    setSaving(false);
    if (error) {
      toast.error(`Erro ao salvar: ${error}`);
      return;
    }
    toast.success(isEdit ? "Tratamento atualizado" : "Tratamento criado");
    onOpenChange(false);
    onSaved();
  };

  const handleDelete = async () => {
    if (!tratamento) return;
    if (!confirm(`Excluir tratamento "${tratamento.descricao}"?`)) return;
    setDeleting(true);
    const { error } = await tratamentosApi.delete(tratamento.id);
    setDeleting(false);
    if (error) {
      toast.error(`Erro ao excluir: ${error}`);
      return;
    }
    toast.success("Tratamento excluído");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" />
            {isEdit ? "Editar Tratamento" : "Novo Tratamento"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">Paciente: <span className="font-medium text-foreground">{pacienteNome}</span></p>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="t-descricao">Descrição *</Label>
            <Input
              id="t-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex: Restauração resina composta"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-dente">Dente / Região</Label>
              <Input
                id="t-dente"
                value={dente}
                onChange={(e) => setDente(e.target.value)}
                placeholder="Ex: 26"
              />
            </div>
            <div>
              <Label htmlFor="t-valor">Valor (R$)</Label>
              <Input
                id="t-valor"
                type="number"
                min="0"
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="t-plano">Plano / Convênio</Label>
              <Input
                id="t-plano"
                value={plano}
                onChange={(e) => setPlano(e.target.value)}
                placeholder="Particular, Unimed…"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="t-obs">Observações</Label>
            <Textarea
              id="t-obs"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              placeholder="Notas clínicas, plano de etapas, materiais…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {isEdit && (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="mr-auto text-destructive border-destructive/30 hover:bg-destructive/5"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || deleting}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar alterações" : "Criar tratamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
