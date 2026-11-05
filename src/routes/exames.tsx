import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Search, FileText, Loader2, Trash2, Filter, FileSignature, Paperclip } from "lucide-react";
import {
  examesApi, exameTiposApi, STATUS_LABELS, STATUS_COLORS,
  type Exame, type ExameStatus, type ExameStats, type ExameTipo, type ExamePrioridade,
} from "@/lib/examesApi";
import { pacientesApi } from "@/lib/vpsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ExameLaudoDialog } from "@/components/ExameLaudoDialog";

export const Route = createFileRoute("/exames")({ component: ExamesPage });

const STATUS_ORDER: ExameStatus[] = ["novo","em_andamento","aguardando_laudo","concluido","entregue","cancelado"];

function ExamesPage() {
  const [exames, setExames] = useState<Exame[]>([]);
  const [tipos, setTipos] = useState<ExameTipo[]>([]);
  const [tiposCarregados, setTiposCarregados] = useState(false);
  const [tiposErro, setTiposErro] = useState<string | null>(null);
  const [pacientes, setPacientes] = useState<Array<{ id: string; nome: string }>>([]);
  const [stats, setStats] = useState<ExameStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ExameStatus | "">("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [laudoExame, setLaudoExame] = useState<Exame | null>(null);
  const [form, setForm] = useState({
    tipo_exame_id: "",
    tipo_nome: "",
    paciente_id: "",
    clinica_origem: "",
    prioridade: "normal" as ExamePrioridade,
    valor: 0,
    modo_entrega: "digital",
    observacoes: "",
    terceirizado: false,
    fornecedor_terc: "",
  });

  async function load() {
    setLoading(true);
    try {
      const [list, st] = await Promise.all([
        examesApi.list({ status: statusFilter || undefined, q: q || undefined }),
        examesApi.stats(),
      ]);
      setExames(list); setStats(st);
    } catch (e) { toast.error("Erro ao carregar exames"); }
    finally { setLoading(false); }
  }

  async function carregarTipos() {
    setTiposErro(null);
    try {
      const t = await exameTiposApi.list();
      setTipos(t);
    } catch (e) {
      const msg = (e as Error)?.message || "erro";
      setTiposErro(msg);
      toast.error("Não foi possível carregar os tipos de exame: " + msg);
    } finally {
      setTiposCarregados(true);
    }
  }

  useEffect(() => {
    // Tipos e pacientes carregam separados: a falha de um não esconde o outro
    carregarTipos();
    (async () => {
      const p = await pacientesApi.list();
      if (p.error) toast.error("Não foi possível carregar a lista de pacientes: " + p.error);
      const pData = p.data;
      setPacientes(Array.isArray(pData) ? (pData as Array<{ id: string; nome: string }>) : []);
    })();
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  async function handleCreate() {
    if (!form.tipo_nome.trim()) {
      return toast.error(tipos.length === 0 ? "Digite o nome do exame" : "Selecione o tipo de exame");
    }
    setSaving(true);
    try {
      await examesApi.create({
        ...form,
        tipo_exame_id: form.tipo_exame_id || null,
        paciente_id: form.paciente_id || null,
      });
      toast.success("Exame criado");
      setOpen(false);
      setForm({ tipo_exame_id:"", tipo_nome:"", paciente_id:"", clinica_origem:"", prioridade:"normal", valor:0, modo_entrega:"digital", observacoes:"", terceirizado:false, fornecedor_terc:"" });
      load();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Erro ao criar");
    } finally { setSaving(false); }
  }

  async function changeStatus(id: string, status: ExameStatus) {
    try {
      await examesApi.update(id, { status });
      toast.success("Status atualizado");
      load();
    } catch (e: unknown) { toast.error((e as Error).message || "Erro ao atualizar status"); }
  }

  async function remove(id: string) {
    if (!confirm("Excluir este pedido de exame? Exames com laudo ou imagem não podem ser excluídos, só cancelados.")) return;
    try { await examesApi.remove(id); toast.success("Pedido de exame excluído"); load(); }
    catch (e: unknown) { toast.error((e as Error).message || "Erro ao excluir"); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Exames</h1>
          <p className="text-sm text-muted-foreground">Gestão de pedidos de exames de imagem odontológica</p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Novo exame
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        <StatCard label="Total" value={stats?.total ?? 0} active={!statusFilter} onClick={() => setStatusFilter("")} />
        {STATUS_ORDER.map(s => (
          <StatCard
            key={s}
            label={STATUS_LABELS[s]}
            value={stats?.[s] ?? 0}
            active={statusFilter === s}
            onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
          />
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, tipo, paciente..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <Filter className="h-4 w-4" /> Filtrar
        </Button>
      </div>

      {/* List */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : exames.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
            Nenhum exame encontrado
          </div>
        ) : (
          <div className="divide-y divide-border">
            {exames.map((e) => (
              <div key={e.id} className="p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-muted-foreground">{e.codigo}</span>
                    <Badge variant="outline" className={STATUS_COLORS[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                    {e.terceirizado && <Badge variant="outline" className="text-xs">Terceirizado</Badge>}
                    {e.prioridade !== "normal" && <Badge variant="outline" className="text-xs capitalize">{e.prioridade}</Badge>}
                    {e.laudo_texto && <Badge variant="outline" className="text-xs gap-1"><FileSignature className="h-3 w-3" />Laudo</Badge>}
                    {((e.arquivos_count ?? 0) > 0 || e.arquivo_url) && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Paperclip className="h-3 w-3" />
                        {(e.arquivos_count ?? 0) > 1 ? `${e.arquivos_count} arquivos` : "Arquivo"}
                      </Badge>
                    )}
                  </div>
                  <div className="font-medium text-sm text-foreground">{e.tipo_nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.paciente_nome || "Sem paciente"} · {new Date(e.data_solicitacao).toLocaleDateString("pt-BR")}
                    {e.valor > 0 && ` · R$ ${Number(e.valor).toFixed(2)}`}
                  </div>
                </div>
                <Select value={e.status} onValueChange={(v) => changeStatus(e.id, v as ExameStatus)}>
                  <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => setLaudoExame(e)}>
                  <FileSignature className="h-4 w-4" /> Laudo
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(e.id)} aria-label="Excluir exame">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ExameLaudoDialog
        exame={laudoExame}
        onOpenChange={(o) => { if (!o) setLaudoExame(null); }}
        onSaved={load}
      />

      {/* New Exame Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Novo exame</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor={tipos.length === 0 ? "novo-exame-tipo-livre" : undefined}>
                {tipos.length === 0 ? "Nome do exame *" : "Tipo de exame *"}
              </Label>
              {tipos.length === 0 && tiposCarregados ? (
                <>
                  <Input
                    id="novo-exame-tipo-livre"
                    placeholder="Ex.: Panorâmica, Tomografia, Periapical"
                    value={form.tipo_nome}
                    onChange={(e) => setForm(f => ({ ...f, tipo_exame_id: "", tipo_nome: e.target.value }))}
                  />
                  {tiposErro ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-xs text-destructive">
                        Não foi possível carregar os tipos de exame. Digite o nome ou tente de novo.
                      </p>
                      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => carregarTipos()}>
                        Tentar de novo
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Esta clínica ainda não tem tipos de exame cadastrados. Digite o nome do exame.
                    </p>
                  )}
                </>
              ) : (
              <Select
                value={form.tipo_exame_id}
                onValueChange={(v) => {
                  const t = tipos.find(x => x.id === v);
                  setForm(f => ({ ...f, tipo_exame_id: v, tipo_nome: t?.nome || "", valor: Number(t?.preco) || 0 }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tipos.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}{t.categoria ? ` · ${t.categoria}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              )}
            </div>
            <div className="col-span-2">
              <Label>Paciente</Label>
              <Select value={form.paciente_id} onValueChange={(v) => setForm(f => ({ ...f, paciente_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {pacientes.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Clínica de origem</Label>
              <Input value={form.clinica_origem} onChange={(e) => setForm(f => ({ ...f, clinica_origem: e.target.value }))} />
            </div>
            <div>
              <Label>Prioridade</Label>
              <Select value={form.prioridade} onValueChange={(v) => setForm(f => ({ ...f, prioridade: v as ExamePrioridade }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor (R$)</Label>
              <Input type="number" step="0.01" value={form.valor} onChange={(e) => setForm(f => ({ ...f, valor: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Modo de entrega</Label>
              <Select value={form.modo_entrega} onValueChange={(v) => setForm(f => ({ ...f, modo_entrega: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="digital">Digital</SelectItem>
                  <SelectItem value="impresso">Impresso</SelectItem>
                  <SelectItem value="retirada">Retirada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea rows={3} value={form.observacoes} onChange={(e) => setForm(f => ({ ...f, observacoes: e.target.value }))} />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.terceirizado} onChange={(e) => setForm(f => ({ ...f, terceirizado: e.target.checked }))} />
              Exame terceirizado
            </label>
            {form.terceirizado && (
              <div className="col-span-2">
                <Label>Fornecedor terceirizado</Label>
                <Input value={form.fornecedor_terc} onChange={(e) => setForm(f => ({ ...f, fornecedor_terc: e.target.value }))} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar exame
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg border text-left transition-all ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
    >
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
    </button>
  );
}
