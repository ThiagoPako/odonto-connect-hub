import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Search, FileText, Loader2, Trash2, Filter, FileSignature, Paperclip, AlertCircle } from "lucide-react";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/exames")({ component: ExamesPage });

const STATUS_ORDER: ExameStatus[] = ["novo","em_andamento","aguardando_laudo","concluido","entregue","cancelado"];

// Catálogo inicial sugerido (sem preço: cada clínica define o seu)
const TIPOS_PADRAO: Array<{ nome: string; categoria: string }> = [
  { nome: "Radiografia Periapical", categoria: "Radiografia" },
  { nome: "Radiografia Interproximal (bite-wing)", categoria: "Radiografia" },
  { nome: "Radiografia Panorâmica", categoria: "Radiografia" },
  { nome: "Telerradiografia Lateral", categoria: "Radiografia" },
  { nome: "Tomografia Computadorizada", categoria: "Tomografia" },
  { nome: "Documentação Ortodôntica", categoria: "Documentação" },
  { nome: "Modelo Digital", categoria: "Modelo" },
  { nome: "Fotografias Intra e Extrabucais", categoria: "Fotografia" },
  { nome: "Laudo Descritivo", categoria: "Laudo" },
];

function ExamesPage() {
  const [exames, setExames] = useState<Exame[]>([]);
  const [tipos, setTipos] = useState<ExameTipo[]>([]);
  const [tiposCarregados, setTiposCarregados] = useState(false);
  const [tiposErro, setTiposErro] = useState<string | null>(null);
  const [pacientes, setPacientes] = useState<Array<{ id: string; nome: string }>>([]);
  const [stats, setStats] = useState<ExameStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [excluir, setExcluir] = useState<Exame | null>(null);
  const [criandoTipos, setCriandoTipos] = useState(false);
  const [buscaPaciente, setBuscaPaciente] = useState("");
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
      setExames(list); setStats(st); setErro(null);
    } catch (e: unknown) {
      // Lista vazia aqui seria enganosa ("nenhum exame"): mostra o erro com "Tentar de novo"
      setErro((e as Error)?.message || "erro de conexão");
    }
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
    try { await examesApi.remove(id); toast.success("Pedido de exame excluído"); load(); }
    catch (e: unknown) { toast.error((e as Error).message || "Erro ao excluir"); }
  }

  async function criarTiposPadrao() {
    setCriandoTipos(true);
    let falhas = 0;
    for (const t of TIPOS_PADRAO) {
      try { await exameTiposApi.upsert({ ...t, preco: 0, ativo: true }); } catch { falhas++; }
    }
    setCriandoTipos(false);
    if (falhas) toast.error(`${falhas} tipo(s) não foram criados. Tente de novo.`);
    else toast.success("Tipos de exame criados. Ajuste os preços quando quiser.");
    carregarTipos();
  }

  const temFiltro = !!statusFilter || !!q.trim();
  const termoPaciente = buscaPaciente.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const pacientesFiltrados = (termoPaciente
    ? pacientes.filter((p) => (p.nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termoPaciente))
    : pacientes
  ).slice(0, 200);
  // O paciente escolhido continua na lista (senão o campo aparece vazio ao mudar o filtro)
  const escolhido = pacientes.find((p) => p.id === form.paciente_id);
  if (escolhido && !pacientesFiltrados.some((p) => p.id === escolhido.id)) pacientesFiltrados.unshift(escolhido);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Exames</h1>
          <p className="text-sm text-muted-foreground">Gestão de pedidos de exames de imagem odontológica</p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Novo exame
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3" role="group" aria-label="Filtrar por status">
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
        <div className="relative flex-1 min-w-0 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Buscar exames por código, tipo ou paciente"
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
          <div className="p-12 flex justify-center" role="status" aria-label="Carregando exames">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : erro ? (
          <div className="p-10 text-center space-y-3" role="alert">
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" aria-hidden />
            <p className="text-sm text-foreground">Não foi possível carregar os exames.</p>
            <p className="text-xs text-muted-foreground">{erro}</p>
            <Button variant="outline" size="sm" onClick={load}>Tentar de novo</Button>
          </div>
        ) : exames.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground space-y-3">
            <FileText className="h-10 w-10 mx-auto opacity-40" aria-hidden />
            {temFiltro ? (
              <>
                <p>Nenhum exame com esse filtro.</p>
                <Button variant="outline" size="sm" onClick={() => { setQ(""); if (statusFilter) setStatusFilter(""); else load(); }}>Limpar filtros</Button>
              </>
            ) : (
              <>
                <p>Nenhum exame ainda. Crie um aqui ou pelo Pedido de Exame.</p>
                <Button size="sm" onClick={() => setOpen(true)} className="gap-1"><Plus className="h-4 w-4" /> Novo exame</Button>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {exames.map((e) => (
              <div key={e.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 hover:bg-muted/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
                    <span className="font-mono text-xs text-muted-foreground">{e.codigo}</span>
                    <Badge variant="outline" className={STATUS_COLORS[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                    {e.terceirizado && <Badge variant="outline" className="text-xs">Terceirizado</Badge>}
                    {e.prioridade !== "normal" && <Badge variant="outline" className="text-xs capitalize">{e.prioridade}</Badge>}
                    {e.laudado_em ? (
                      <Badge variant="outline" className="text-xs gap-1" title={e.laudado_por_nome ? `Finalizado por ${e.laudado_por_nome}` : undefined}>
                        <FileSignature className="h-3 w-3" />Laudo finalizado
                      </Badge>
                    ) : e.laudo_texto ? (
                      <Badge variant="outline" className="text-xs gap-1"><FileSignature className="h-3 w-3" />Laudo em rascunho</Badge>
                    ) : null}
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
                <div className="flex items-center gap-2">
                <Select value={e.status} onValueChange={(v) => changeStatus(e.id, v as ExameStatus)}>
                  <SelectTrigger className="flex-1 sm:flex-none sm:w-[170px]" aria-label={`Status do exame ${e.codigo ?? ""}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map(s => (
                      // Concluído só pelo "Finalizar laudo"; com laudo finalizado, só Entregue
                      <SelectItem key={s} value={s}
                        disabled={s !== e.status && ((s === "concluido" && !e.laudado_em) || (!!e.laudado_em && s !== "entregue"))}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="gap-1 h-9" onClick={() => setLaudoExame(e)} aria-label={`Laudo e imagens do exame ${e.codigo ?? ""}`}>
                  <FileSignature className="h-4 w-4" /> Laudo
                </Button>
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setExcluir(e)} aria-label={`Excluir exame ${e.codigo ?? ""}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
                </div>
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

      <AlertDialog open={!!excluir} onOpenChange={(o) => { if (!o) setExcluir(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o pedido {excluir?.codigo}?</AlertDialogTitle>
            <AlertDialogDescription>
              Só pedidos sem laudo e sem imagem podem ser excluídos. Exame com resultado faz parte do prontuário:
              nesse caso, mude o status para Cancelado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (excluir) remove(excluir.id); setExcluir(null); }}
            >
              Excluir pedido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Exame Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo exame</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label htmlFor={tipos.length === 0 ? "novo-exame-tipo-livre" : "novo-exame-tipo"}>
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
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        Esta clínica ainda não tem tipos de exame cadastrados. Digite o nome do exame ou crie a lista básica.
                      </p>
                      <Button type="button" variant="outline" size="sm" className="h-8" onClick={criarTiposPadrao} disabled={criandoTipos}>
                        {criandoTipos && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Criar tipos básicos
                      </Button>
                    </div>
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
                <SelectTrigger id="novo-exame-tipo"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tipos.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}{t.categoria ? ` · ${t.categoria}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="novo-exame-paciente">Paciente</Label>
              {pacientes.length > 20 && (
                <Input
                  className="mb-2"
                  placeholder="Digite parte do nome para filtrar a lista"
                  aria-label="Filtrar pacientes pelo nome"
                  value={buscaPaciente}
                  onChange={(e) => setBuscaPaciente(e.target.value)}
                />
              )}
              <Select value={form.paciente_id} onValueChange={(v) => setForm(f => ({ ...f, paciente_id: v }))}>
                <SelectTrigger id="novo-exame-paciente"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {pacientesFiltrados.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                  {pacientesFiltrados.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Nenhum paciente com esse nome.</div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="novo-exame-origem">Clínica de origem</Label>
              <Input id="novo-exame-origem" value={form.clinica_origem} onChange={(e) => setForm(f => ({ ...f, clinica_origem: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="novo-exame-prioridade">Prioridade</Label>
              <Select value={form.prioridade} onValueChange={(v) => setForm(f => ({ ...f, prioridade: v as ExamePrioridade }))}>
                <SelectTrigger id="novo-exame-prioridade"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="novo-exame-valor">Valor (R$)</Label>
              <Input id="novo-exame-valor" type="number" min={0} step="0.01" value={form.valor} onChange={(e) => setForm(f => ({ ...f, valor: Number(e.target.value) }))} />
            </div>
            <div>
              <Label htmlFor="novo-exame-entrega">Modo de entrega</Label>
              <Select value={form.modo_entrega} onValueChange={(v) => setForm(f => ({ ...f, modo_entrega: v }))}>
                <SelectTrigger id="novo-exame-entrega"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="digital">Digital</SelectItem>
                  <SelectItem value="impresso">Impresso</SelectItem>
                  <SelectItem value="retirada">Retirada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="novo-exame-obs">Observações</Label>
              <Textarea id="novo-exame-obs" rows={3} value={form.observacoes} onChange={(e) => setForm(f => ({ ...f, observacoes: e.target.value }))} />
            </div>
            <label className="sm:col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.terceirizado} onChange={(e) => setForm(f => ({ ...f, terceirizado: e.target.checked }))} />
              Exame terceirizado
            </label>
            {form.terceirizado && (
              <div className="sm:col-span-2">
                <Label htmlFor="novo-exame-fornecedor">Fornecedor terceirizado</Label>
                <Input id="novo-exame-fornecedor" value={form.fornecedor_terc} onChange={(e) => setForm(f => ({ ...f, fornecedor_terc: e.target.value }))} />
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`p-2.5 sm:p-3 rounded-lg border text-left transition-all ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
    >
      <div className="text-xl sm:text-2xl font-bold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
    </button>
  );
}
