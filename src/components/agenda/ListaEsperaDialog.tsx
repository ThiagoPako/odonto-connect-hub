import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listaEsperaApi, pacientesApi, type ListaEsperaItem } from "@/lib/vpsApi";

const PERIODOS: { value: ListaEsperaItem["periodo"]; label: string }[] = [
  { value: "qualquer", label: "Qualquer horário" },
  { value: "manha", label: "Manhã (antes das 12h)" },
  { value: "tarde", label: "Tarde (12h–18h)" },
  { value: "noite", label: "Noite (depois das 18h)" },
];
const PERIODO_LABEL = Object.fromEntries(PERIODOS.map((p) => [p.value, p.label]));

interface Paciente { id: string; nome: string; telefone?: string }

// Tela mínima da lista de espera da clínica: incluir, ver e remover.
export function ListaEsperaDialog({ open, onOpenChange, professionals }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  professionals: { id: string; nome: string }[];
}) {
  const [items, setItems] = useState<ListaEsperaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [busca, setBusca] = useState("");
  const [pacienteId, setPacienteId] = useState("");
  const [dentistaId, setDentistaId] = useState("_qualquer");
  const [periodo, setPeriodo] = useState<ListaEsperaItem["periodo"]>("qualquer");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listaEsperaApi.list();
    setLoading(false);
    if (error) { setErro(error); return; }
    setErro(null);
    setItems(data || []);
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
    pacientesApi.list().then(({ data, error }) => {
      if (error) toast.error("Erro ao carregar pacientes: " + error);
      else setPacientes((data as Paciente[]) || []);
    });
  }, [open, load]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (t.length < 2) return [];
    return pacientes.filter((p) => p.nome?.toLowerCase().includes(t)).slice(0, 8);
  }, [busca, pacientes]);
  const selecionado = pacientes.find((p) => p.id === pacienteId);

  const incluir = async () => {
    if (!pacienteId) { toast.error("Selecione o paciente"); return; }
    setSaving(true);
    const { error } = await listaEsperaApi.add({ paciente_id: pacienteId, dentista_id: dentistaId === "_qualquer" ? null : dentistaId, periodo });
    setSaving(false);
    if (error) { toast.error(error); return; }
    toast.success("Paciente incluído na lista de espera");
    setPacienteId(""); setBusca(""); setDentistaId("_qualquer"); setPeriodo("qualquer");
    load();
  };

  const remover = async (id: string) => {
    const { error } = await listaEsperaApi.remove(id);
    if (error) { toast.error(error); return; }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Lista de espera</DialogTitle>
          <DialogDescription>
            Adicione só quem pediu para entrar na lista. Ele vai receber a oferta pelo WhatsApp da clínica. Quando a recepção desmarca ou cancela um horário, a agenda mostra quem da lista serve para ele. A oferta só sai quando a recepção clica em "Oferecer horário".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border border-border/60 p-3">
          <div>
            <Label htmlFor="le-busca" className="text-xs">Paciente</Label>
            {selecionado ? (
              <div className="mt-1 flex items-center justify-between rounded border border-border/60 px-2 py-1.5 text-sm">
                <span>{selecionado.nome}{!selecionado.telefone && <span className="ml-2 text-[11px] text-warning">sem telefone: não recebe oferta</span>}</span>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setPacienteId("")}>Trocar</Button>
              </div>
            ) : (
              <>
                <Input id="le-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite ao menos 2 letras do nome" className="mt-1" />
                {filtrados.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-border/60">
                    {filtrados.map((p) => (
                      <li key={p.id}>
                        <button type="button" className="w-full px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => setPacienteId(p.id)}>
                          {p.nome}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Profissional</Label>
              <Select value={dentistaId} onValueChange={setDentistaId}>
                <SelectTrigger aria-label="Profissional preferido" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_qualquer">Qualquer profissional</SelectItem>
                  {professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Período</Label>
              <Select value={periodo} onValueChange={(v) => setPeriodo(v as ListaEsperaItem["periodo"])}>
                <SelectTrigger aria-label="Período preferido" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODOS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" onClick={incluir} disabled={saving || !pacienteId} className="w-full">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <UserPlus className="h-3.5 w-3.5 mr-1" />}
            Incluir na lista
          </Button>
        </div>

        <div className="max-h-64 overflow-y-auto" aria-live="polite">
          {loading && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>}
          {erro && <div className="text-sm text-destructive">Não foi possível carregar a lista: {erro}</div>}
          {!loading && !erro && items.length === 0 && <div className="text-sm text-muted-foreground">Ninguém na lista de espera.</div>}
          <ul className="divide-y divide-border/60">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium break-words">{i.paciente_nome}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {i.dentista_nome || "Qualquer profissional"} · {PERIODO_LABEL[i.periodo] || i.periodo} · desde {new Date(i.created_at).toLocaleDateString("pt-BR")}
                    {i.status === "oferecido" && <span className="ml-1 text-primary">· oferta aguardando resposta</span>}
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Remover ${i.paciente_nome} da lista`} onClick={() => remover(i.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
