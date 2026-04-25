import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertTriangle, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { agendaApi, dentistasApi, procedimentosCatalogoApi, type AgendamentoVPS, type ProcedimentoCatalogo } from "@/lib/vpsApi";

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

// Status que NÃO ocupam horário (não geram conflito)
const FREE_STATUSES = new Set(["cancelado", "faltou"]);

function timeToMin(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function EditarAgendamentoModal({ appointment, open, onOpenChange, onSaved }: Props) {
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [duracao, setDuracao] = useState(30);
  const [procedimento, setProcedimento] = useState("");
  const [categoria, setCategoria] = useState<string>("");
  const [categoriaCor, setCategoriaCor] = useState<string>("");
  const [status, setStatus] = useState("agendado");
  const [sala, setSala] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [dentistaId, setDentistaId] = useState("");
  const [profs, setProfs] = useState<Prof[]>([]);
  const [catalogo, setCatalogo] = useState<ProcedimentoCatalogo[]>([]);
  const [comboOpen, setComboOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dayAppts, setDayAppts] = useState<AgendamentoVPS[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);

  useEffect(() => {
    if (!open) return;
    dentistasApi.list().then(({ data }) => {
      if (Array.isArray(data)) setProfs(data as Prof[]);
    }).catch(() => {});
    procedimentosCatalogoApi.list().then(({ data }) => {
      if (Array.isArray(data)) setCatalogo(data.filter((p) => p.ativo));
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!appointment) return;
    setData(appointment.data || "");
    setHora(appointment.hora || "");
    setDuracao(appointment.duracao || 30);
    setProcedimento(appointment.procedimento || "");
    setCategoria(appointment.categoria || "");
    setCategoriaCor(appointment.categoria_cor || "");
    setStatus(appointment.status || "agendado");
    setSala(appointment.sala || "");
    setObservacoes(appointment.observacoes || "");
    setDentistaId(appointment.dentista_id || "");
  }, [appointment]);

  // Agrupa catálogo por categoria para o combobox
  const catalogoPorCategoria = useMemo(() => {
    const map = new Map<string, ProcedimentoCatalogo[]>();
    for (const p of catalogo) {
      const cat = p.categoria || "Sem categoria";
      const arr = map.get(cat) || [];
      arr.push(p);
      map.set(cat, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [catalogo]);

  const handlePickProcedimento = (p: ProcedimentoCatalogo) => {
    setProcedimento(p.nome);
    setCategoria(p.categoria || "");
    setCategoriaCor(p.cor || "");
    if (p.duracao_minutos) setDuracao(p.duracao_minutos);
    setComboOpen(false);
  };

  // Carrega agendamentos do dia/profissional para checar conflitos
  useEffect(() => {
    if (!open || !data || !dentistaId) {
      setDayAppts([]);
      return;
    }
    setLoadingDay(true);
    agendaApi
      .list({ data_inicio: data, data_fim: data, dentista_id: dentistaId })
      .then(({ data: list }) => {
        if (Array.isArray(list)) setDayAppts(list);
      })
      .catch(() => {})
      .finally(() => setLoadingDay(false));
  }, [open, data, dentistaId]);

  // Detecta conflitos: mesmo profissional, mesma data, intervalos sobrepostos,
  // ignorando o próprio agendamento e os de status livre.
  const conflicts = useMemo(() => {
    if (!appointment || !hora || !duracao || FREE_STATUSES.has(status)) return [];
    const start = timeToMin(hora);
    const end = start + duracao;
    return dayAppts.filter((a) => {
      if (a.id === appointment.id) return false;
      if (FREE_STATUSES.has(a.status)) return false;
      if (a.dentista_id !== dentistaId) return false;
      const s = timeToMin(a.hora);
      const e = s + (a.duracao || 30);
      return start < e && s < end; // sobreposição
    });
  }, [appointment, dayAppts, hora, duracao, dentistaId, status]);

  const hasConflict = conflicts.length > 0;

  if (!appointment) return null;

  const handleSave = async () => {
    if (hasConflict) {
      toast.error("Existe conflito de horário. Ajuste antes de salvar.");
      return;
    }
    setSaving(true);
    const dent = profs.find((p) => p.id === dentistaId);
    const { error } = await agendaApi.update(appointment.id, {
      data,
      hora,
      duracao,
      procedimento,
      categoria,
      categoria_cor: categoriaCor,
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
            <Popover open={comboOpen} onOpenChange={setComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboOpen}
                  className="w-full justify-between font-normal"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {categoriaCor && (
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ background: categoriaCor }}
                      />
                    )}
                    <span className={cn("truncate", !procedimento && "text-muted-foreground")}>
                      {procedimento || "Selecione um procedimento…"}
                    </span>
                    {categoria && (
                      <span className="text-[10px] text-muted-foreground shrink-0">· {categoria}</span>
                    )}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar procedimento ou categoria…" />
                  <CommandList>
                    <CommandEmpty>Nenhum procedimento encontrado.</CommandEmpty>
                    {catalogoPorCategoria.map(([cat, items]) => (
                      <CommandGroup key={cat} heading={cat}>
                        {items.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.nome} ${p.categoria || ""} ${p.codigo || ""}`}
                            onSelect={() => handlePickProcedimento(p)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                procedimento === p.nome ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span
                              className="h-2.5 w-2.5 rounded-full mr-2 shrink-0"
                              style={{ background: p.cor || "var(--muted-foreground)" }}
                            />
                            <span className="flex-1 truncate">{p.nome}</span>
                            {p.duracao_minutos > 0 && (
                              <span className="ml-2 text-[10px] text-muted-foreground">
                                {p.duracao_minutos}min
                              </span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-[10px] text-muted-foreground">
              Selecionar atualiza a categoria, cor e duração padrão automaticamente.
            </p>
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

          {hasConflict && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Conflito de horário</AlertTitle>
              <AlertDescription>
                Este profissional já tem {conflicts.length === 1 ? "um agendamento" : `${conflicts.length} agendamentos`} sobrepostos:
                <ul className="mt-1.5 space-y-0.5 list-disc list-inside text-xs">
                  {conflicts.slice(0, 4).map((c) => {
                    const ini = c.hora;
                    const fim = minToHHMM(timeToMin(c.hora) + (c.duracao || 30));
                    return (
                      <li key={c.id}>
                        <span className="font-medium">{c.paciente_nome || "—"}</span>
                        {" · "}
                        {ini}–{fim}
                        {c.procedimento ? ` · ${c.procedimento}` : ""}
                      </li>
                    );
                  })}
                  {conflicts.length > 4 && <li>e mais {conflicts.length - 4}…</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {loadingDay && (
            <p className="text-[11px] text-muted-foreground">Verificando disponibilidade…</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || hasConflict}>
            {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
