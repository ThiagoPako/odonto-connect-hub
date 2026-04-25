/**
 * Modal: Novo / Editar Orçamento (Fase B)
 *
 * Layout em 2 colunas:
 *  • Esquerda: paciente, dentista, procedimento ativo, lista de itens, totais
 *  • Direita:  Odontograma interativo (permanente / decíduo) com faces
 *
 * Fluxo: usuário escolhe um procedimento no select → clica em faces do dente
 *        → cada combinação dente+face vira um item na lista da esquerda
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import {
  pacientesApi,
  dentistasApi,
  procedimentosCatalogoApi,
  orcamentosApi,
  type ProcedimentoCatalogo,
} from "@/lib/vpsApi";
import { OdontogramaInterativo, type FaceSelection, type Face } from "./OdontogramaInterativo";
import { DEFAULT_PRINT_CONFIG, type OrcamentoItemEstruturado, type PrintConfig } from "./types";
import { OrcamentoPrintPreview } from "./OrcamentoPrintPreview";

interface OrcamentoEdit {
  id: string;
  paciente_id: string;
  dentista_id?: string | null;
  titulo?: string | null;
  itens: any[];
  valor_total: number;
  desconto: number;
  observacoes?: string | null;
  forma_pagamento?: string | null;
  parcelas?: number;
  print_config?: PrintConfig | null;
  odontograma_snapshot?: FaceSelection[] | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pacientePreSelecionadoId?: string | null;
  /** Quando informado, o modal entra em modo "editar" (chama update em vez de create) */
  orcamentoEditar?: OrcamentoEdit | null;
  onSaved?: () => void;
}

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function uid() {
  return (typeof crypto !== "undefined" && (crypto as any).randomUUID)
    ? (crypto as any).randomUUID()
    : Math.random().toString(36).slice(2);
}

export function NovoOrcamentoModal({
  open,
  onOpenChange,
  pacientePreSelecionadoId,
  orcamentoEditar,
  onSaved,
}: Props) {
  const [pacientes, setPacientes] = useState<any[]>([]);
  const [dentistas, setDentistas] = useState<any[]>([]);
  const [procedimentos, setProcedimentos] = useState<ProcedimentoCatalogo[]>([]);

  const [pacienteId, setPacienteId] = useState<string>("");
  const [dentistaId, setDentistaId] = useState<string>("");
  const [titulo, setTitulo] = useState<string>("Plano de tratamento");
  const [observacoes, setObservacoes] = useState("");
  const [desconto, setDesconto] = useState<number>(0);
  const [formaPagamento, setFormaPagamento] = useState<string>("");
  const [parcelas, setParcelas] = useState<number>(1);

  const [procedimentoAtivoId, setProcedimentoAtivoId] = useState<string>("");
  const [itens, setItens] = useState<OrcamentoItemEstruturado[]>([]);
  const [printConfig, setPrintConfig] = useState<PrintConfig>(DEFAULT_PRINT_CONFIG);

  const [saving, setSaving] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  // Carregar listas
  useEffect(() => {
    if (!open) return;
    (async () => {
      const [p, d, c] = await Promise.all([
        pacientesApi.list(),
        dentistasApi.list(),
        procedimentosCatalogoApi.list(),
      ]);
      setPacientes(((p as any).data || p || []) as any[]);
      setDentistas(((d as any).data || d || []) as any[]);
      const cat = ((c as any).data || c || []) as ProcedimentoCatalogo[];
      setProcedimentos(cat);
      // Pré-seleciona o primeiro
      if (cat.length > 0 && !procedimentoAtivoId) {
        setProcedimentoAtivoId(cat[0].id);
      }
    })();
    if (pacientePreSelecionadoId) setPacienteId(pacientePreSelecionadoId);
  }, [open, pacientePreSelecionadoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset ao fechar
  useEffect(() => {
    if (!open) {
      setItens([]);
      setObservacoes("");
      setDesconto(0);
      setTitulo("Plano de tratamento");
      setFormaPagamento("");
      setParcelas(1);
      setShowPrint(false);
    }
  }, [open]);

  // Carrega dados ao entrar em modo edição
  useEffect(() => {
    if (!open || !orcamentoEditar) return;
    setPacienteId(orcamentoEditar.paciente_id || "");
    setDentistaId(orcamentoEditar.dentista_id || "");
    setTitulo(orcamentoEditar.titulo || "Plano de tratamento");
    setObservacoes(orcamentoEditar.observacoes || "");
    setDesconto(Number(orcamentoEditar.desconto) || 0);
    setFormaPagamento(orcamentoEditar.forma_pagamento || "");
    setParcelas(Number(orcamentoEditar.parcelas) || 1);
    if (orcamentoEditar.print_config) setPrintConfig(orcamentoEditar.print_config);
    // Reidrata itens — aceita formato estruturado novo OU itens antigos (sem id local)
    const reHidratados: OrcamentoItemEstruturado[] = (orcamentoEditar.itens || []).map((it: any) => ({
      id: it.id || uid(),
      procedimento_id: it.procedimento_id || "",
      procedimento_nome: it.procedimento_nome || it.procedimento || it.descricao || "Procedimento",
      procedimento_codigo: it.procedimento_codigo || it.codigo || null,
      dente: it.dente ?? null,
      faces: Array.isArray(it.faces) ? it.faces : [],
      quantidade: Number(it.quantidade) || 1,
      valor_unitario: Number(it.valor_unitario || it.valor) || 0,
      valor_total: Number(it.valor_total || it.valor) || 0,
      cor: it.cor,
      observacao: it.observacao || it.observacoes || undefined,
    }));
    setItens(reHidratados);
  }, [open, orcamentoEditar]);

  const procAtivo = procedimentos.find((p) => p.id === procedimentoAtivoId);

  // Selections agregadas para o odontograma (cor por dente = cor do último procedimento aplicado)
  const selections: FaceSelection[] = useMemo(() => {
    const map = new Map<number, FaceSelection>();
    for (const it of itens) {
      if (!it.dente) continue;
      const ex = map.get(it.dente);
      const newFaces = Array.from(new Set([...(ex?.faces ?? []), ...((it.faces as Face[]) ?? [])]));
      map.set(it.dente, { dente: it.dente, faces: newFaces, cor: it.cor });
    }
    return Array.from(map.values());
  }, [itens]);

  // Quando o usuário interage com o odontograma:
  //   • Adicionar face = adiciona/atualiza item para o procedimento ativo
  //   • Remover face   = remove os itens daquele procedimento+dente que tinham aquela face
  const handleOdontogramaChange = useCallback(
    (next: FaceSelection[]) => {
      if (!procAtivo) {
        toast.error("Selecione um procedimento primeiro");
        return;
      }
      const prev = selections;
      const prevMap = new Map(prev.map((s) => [s.dente, s.faces]));
      const nextMap = new Map(next.map((s) => [s.dente, s.faces]));

      // detectar adições/remoções
      const added: { dente: number; face: Face }[] = [];
      const removed: { dente: number; face: Face }[] = [];

      const allTeeth = new Set<number>([...prevMap.keys(), ...nextMap.keys()]);
      for (const t of allTeeth) {
        const a = new Set(prevMap.get(t) ?? []);
        const b = new Set(nextMap.get(t) ?? []);
        for (const f of b) if (!a.has(f)) added.push({ dente: t, face: f as Face });
        for (const f of a) if (!b.has(f)) removed.push({ dente: t, face: f as Face });
      }

      setItens((current) => {
        let updated = [...current];
        for (const { dente, face } of removed) {
          updated = updated
            .map((it) =>
              it.dente === dente && it.procedimento_id === procAtivo.id
                ? { ...it, faces: (it.faces ?? []).filter((f) => f !== face) }
                : it
            )
            .filter((it) => !(it.dente === dente && (it.faces ?? []).length === 0 && procAtivo.requer_face));
        }
        for (const { dente, face } of added) {
          // tenta achar item existente do mesmo procedimento+dente para apenas anexar a face
          const idx = updated.findIndex(
            (it) => it.procedimento_id === procAtivo.id && it.dente === dente
          );
          if (idx >= 0) {
            const it = updated[idx];
            updated[idx] = { ...it, faces: Array.from(new Set([...(it.faces ?? []), face])) };
          } else {
            const valor = procAtivo.valor_particular || 0;
            updated.push({
              id: uid(),
              procedimento_id: procAtivo.id,
              procedimento_nome: procAtivo.nome,
              procedimento_codigo: procAtivo.codigo,
              dente,
              faces: [face],
              quantidade: 1,
              valor_unitario: valor,
              valor_total: valor,
              cor: procAtivo.cor,
            });
          }
        }
        return updated;
      });
    },
    [procAtivo, selections]
  );

  // Procedimento sem dente (ex: limpeza, anestesia geral) — adicionado por botão
  const adicionarProcedimentoAvulso = () => {
    if (!procAtivo) return;
    const valor = procAtivo.valor_particular || 0;
    setItens((cur) => [
      ...cur,
      {
        id: uid(),
        procedimento_id: procAtivo.id,
        procedimento_nome: procAtivo.nome,
        procedimento_codigo: procAtivo.codigo,
        dente: null,
        faces: [],
        quantidade: 1,
        valor_unitario: valor,
        valor_total: valor,
        cor: procAtivo.cor,
      },
    ]);
  };

  const removerItem = (id: string) =>
    setItens((cur) => cur.filter((it) => it.id !== id));

  const atualizarQuantidade = (id: string, q: number) =>
    setItens((cur) =>
      cur.map((it) =>
        it.id === id
          ? { ...it, quantidade: q, valor_total: q * it.valor_unitario }
          : it
      )
    );

  const atualizarValorUnit = (id: string, v: number) =>
    setItens((cur) =>
      cur.map((it) =>
        it.id === id
          ? { ...it, valor_unitario: v, valor_total: it.quantidade * v }
          : it
      )
    );

  const subtotal = itens.reduce((acc, it) => acc + it.valor_total, 0);
  const total = Math.max(0, subtotal - desconto);

  const pacienteSelecionado = pacientes.find((p) => p.id === pacienteId);
  const dentistaSelecionado = dentistas.find((d) => d.id === dentistaId);

  const salvar = async () => {
    if (!pacienteId) { toast.error("Selecione o paciente"); return; }
    if (itens.length === 0) { toast.error("Adicione ao menos um procedimento"); return; }
    setSaving(true);
    try {
      const body = {
        paciente_id: pacienteId,
        dentista_id: dentistaId || null,
        titulo,
        itens: itens.map((it) => ({
          procedimento_id: it.procedimento_id,
          procedimento: it.procedimento_nome,
          codigo: it.procedimento_codigo,
          dente: it.dente,
          faces: it.faces,
          quantidade: it.quantidade,
          valor_unitario: it.valor_unitario,
          valor: it.valor_total,
          cor: it.cor,
        })),
        valor_total: subtotal,
        desconto,
        observacoes,
        forma_pagamento: formaPagamento || null,
        parcelas,
        print_config: printConfig,
        odontograma_snapshot: selections,
      };
      const res = await orcamentosApi.create(body);
      if ((res as any).error) throw new Error((res as any).error);
      toast.success("Orçamento criado com sucesso");
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Novo Orçamento / Plano de Tratamento</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* COLUNA ESQUERDA — formulário + itens */}
            <div className="lg:col-span-3 space-y-4">
              {/* Paciente / Dentista */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Paciente *</Label>
                  <Select value={pacienteId} onValueChange={setPacienteId}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {pacientes.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">{p.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Dentista responsável</Label>
                  <Select value={dentistaId} onValueChange={setDentistaId}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>
                      {dentistas.map((d) => (
                        <SelectItem key={d.id} value={d.id} className="text-xs">{d.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Título do orçamento</Label>
                <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="h-9 text-xs" />
              </div>

              {/* Procedimento ativo */}
              <div className="bg-muted/40 border border-border rounded-lg p-3 space-y-2">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Procedimento ativo
                </Label>
                <div className="flex gap-2">
                  <Select value={procedimentoAtivoId} onValueChange={setProcedimentoAtivoId}>
                    <SelectTrigger className="h-9 text-xs flex-1">
                      <SelectValue placeholder="Selecione um procedimento do catálogo" />
                    </SelectTrigger>
                    <SelectContent>
                      {procedimentos.length === 0 && (
                        <div className="p-2 text-xs text-muted-foreground">
                          Cadastre procedimentos em /tratamentos
                        </div>
                      )}
                      {procedimentos.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.cor }} />
                            {p.nome}
                            <span className="text-muted-foreground ml-auto">{fmt(p.valor_particular)}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {procAtivo && !procAtivo.requer_dente && (
                    <Button size="sm" variant="outline" onClick={adicionarProcedimentoAvulso} className="h-9 text-xs">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar
                    </Button>
                  )}
                </div>
                {procAtivo && (
                  <p className="text-[11px] text-muted-foreground">
                    {procAtivo.requer_dente
                      ? "Clique nas faces do dente no odontograma →"
                      : "Procedimento avulso — clique em \"Adicionar\""}
                  </p>
                )}
              </div>

              {/* Lista de itens */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground grid grid-cols-12 gap-2">
                  <span className="col-span-5">Procedimento</span>
                  <span className="col-span-2 text-center">Dente / Face</span>
                  <span className="col-span-1 text-center">Qtd</span>
                  <span className="col-span-2 text-right">Vlr Unit.</span>
                  <span className="col-span-2 text-right">Total</span>
                </div>
                {itens.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    Nenhum item — selecione faces no odontograma
                  </div>
                ) : (
                  <div className="divide-y divide-border max-h-[260px] overflow-y-auto">
                    {itens.map((it) => (
                      <div key={it.id} className="px-3 py-2 grid grid-cols-12 gap-2 items-center text-xs">
                        <div className="col-span-5 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: it.cor }} />
                          <span className="truncate font-medium text-foreground">{it.procedimento_nome}</span>
                        </div>
                        <div className="col-span-2 text-center text-muted-foreground">
                          {it.dente ? (
                            <>
                              <span className="font-bold text-foreground">{it.dente}</span>
                              {it.faces && it.faces.length > 0 && (
                                <span className="ml-1">({it.faces.join(",")})</span>
                              )}
                            </>
                          ) : "—"}
                        </div>
                        <Input
                          type="number"
                          min={1}
                          value={it.quantidade}
                          onChange={(e) => atualizarQuantidade(it.id, Math.max(1, Number(e.target.value)))}
                          className="col-span-1 h-7 text-xs text-center px-1"
                        />
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={it.valor_unitario}
                          onChange={(e) => atualizarValorUnit(it.id, Number(e.target.value))}
                          className="col-span-2 h-7 text-xs text-right"
                        />
                        <div className="col-span-2 flex items-center justify-end gap-2">
                          <span className="font-semibold text-foreground">{fmt(it.valor_total)}</span>
                          <button onClick={() => removerItem(it.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Totais + pagamento */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Forma de pagamento</Label>
                  <Select value={formaPagamento} onValueChange={setFormaPagamento}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {["Dinheiro","PIX","Cartão de crédito","Cartão de débito","Boleto","Convênio"].map((f) => (
                        <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Label className="text-xs">Parcelas</Label>
                  <Input type="number" min={1} max={24} value={parcelas}
                    onChange={(e) => setParcelas(Math.max(1, Number(e.target.value)))}
                    className="h-9 text-xs" />
                </div>

                <div className="space-y-1.5 bg-muted/40 border border-border rounded-lg p-3">
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Subtotal</span><span className="font-semibold">{fmt(subtotal)}</span></div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Desconto (R$)</span>
                    <Input type="number" min={0} step="0.01" value={desconto}
                      onChange={(e) => setDesconto(Number(e.target.value))}
                      className="h-7 text-xs text-right w-24" />
                  </div>
                  <div className="border-t border-border pt-1.5 flex justify-between text-sm font-bold">
                    <span>Total</span><span className="text-primary">{fmt(total)}</span>
                  </div>
                  {parcelas > 1 && total > 0 && (
                    <p className="text-[10px] text-muted-foreground text-right">
                      {parcelas}x de {fmt(total / parcelas)}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Observações</Label>
                <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
                  rows={2} className="text-xs" placeholder="Notas, condições, validade, etc." />
              </div>
            </div>

            {/* COLUNA DIREITA — Odontograma + impressão */}
            <div className="lg:col-span-2 space-y-3">
              <OdontogramaInterativo
                selections={selections}
                onChange={handleOdontogramaChange}
                activeColor={procAtivo?.cor ?? "hsl(var(--primary))"}
              />

              {/* Configuração de impressão */}
              <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-2">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Configuração de impressão
                </Label>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {(Object.keys(printConfig) as (keyof PrintConfig)[]).map((k) => (
                    <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={printConfig[k]}
                        onChange={(e) => setPrintConfig({ ...printConfig, [k]: e.target.checked })}
                        className="rounded border-border accent-primary"
                      />
                      <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border pt-3 mt-2">
            <Button variant="outline" size="sm" onClick={() => setShowPrint(true)}
              disabled={itens.length === 0 || !pacienteId} className="h-9 text-xs">
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Pré-visualizar impressão
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-9 text-xs">Cancelar</Button>
              <Button size="sm" onClick={salvar} disabled={saving} className="h-9 text-xs">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Salvar orçamento
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showPrint && pacienteSelecionado && (
        <OrcamentoPrintPreview
          open={showPrint}
          onOpenChange={setShowPrint}
          paciente={pacienteSelecionado}
          dentista={dentistaSelecionado}
          titulo={titulo}
          itens={itens}
          subtotal={subtotal}
          desconto={desconto}
          total={total}
          observacoes={observacoes}
          formaPagamento={formaPagamento}
          parcelas={parcelas}
          selections={selections}
          config={printConfig}
        />
      )}
    </>
  );
}
