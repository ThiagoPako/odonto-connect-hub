import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, Loader2, Paperclip, Printer, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  examesApi, exameArquivosApi, formatarTamanho, urlArquivoExame, STATUS_LABELS,
  type Exame, type ExameArquivo, type ExameUpdate,
} from "@/lib/examesApi";
import { resolveMediaUrl } from "@/lib/vpsApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExameImagemViewer } from "@/components/ExameImagemViewer";
import { imprimirLaudo } from "@/lib/laudoImpressao";

const ACEITOS = "image/jpeg,image/png,image/webp,image/gif,image/bmp,application/pdf,.dcm,application/dicom,.zip,application/zip";

interface Props {
  exame: Exame | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ExameLaudoDialog({ exame: exameProp, onOpenChange, onSaved }: Props) {
  // Cópia local: atualizada depois de enviar arquivo, finalizar ou reabrir (a versão muda)
  const [exame, setExame] = useState<Exame | null>(exameProp);
  const [laudo, setLaudo] = useState("");
  const [legadoUrl, setLegadoUrl] = useState<string | null>(null);
  const [acao, setAcao] = useState<null | "finalizar" | "reabrir">(null);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [arquivos, setArquivos] = useState<ExameArquivo[]>([]);
  const [arquivosEstado, setArquivosEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [arquivosErro, setArquivosErro] = useState<string | null>(null);
  const [verId, setVerId] = useState<string | null>(null);
  const [alterou, setAlterou] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exameId = exameProp?.id ?? null;

  const carregarArquivos = useCallback(async () => {
    if (!exameId) return;
    setArquivosEstado("carregando");
    try {
      setArquivos(await exameArquivosApi.list(exameId));
      setArquivosEstado("ok");
    } catch (e: unknown) {
      setArquivosErro((e as Error).message || "erro");
      setArquivosEstado("erro");
    }
  }, [exameId]);

  useEffect(() => {
    setExame(exameProp);
    if (!exameProp) return;
    setLaudo(exameProp.laudo_texto ?? "");
    setLegadoUrl(exameProp.arquivo_url ?? null);
    setVerId(null);
    setAlterou(false);
    setArquivos([]);
    carregarArquivos();
    // Versão completa (clínica, nascimento, quem laudou) para impressão e controle de edição
    let ativo = true;
    examesApi.get(exameProp.id).then((e) => { if (ativo) setExame(e); }).catch(() => { /* usa a cópia da lista */ });
    return () => { ativo = false; };
  }, [exameProp, carregarArquivos]);

  async function recarregarExame(id: string) {
    try { setExame(await examesApi.get(id)); } catch { /* mantém a cópia atual; o próximo salvar avisa se mudou */ }
  }

  if (!exame) return null;

  const finalizado = !!exame.laudado_em;
  const podeFinalizar = !finalizado && exame.status !== "cancelado";
  const imagens = arquivos.filter((a) => a.imagem);
  const legadoResolvido = resolveMediaUrl(legadoUrl);
  const legadoNome = legadoUrl?.split("?")[0].split("/").pop() ?? "";

  async function handleFiles(files: FileList | null) {
    const lista = Array.from(files ?? []);
    if (!lista.length || !exame) return;
    setUploading(lista.length);
    let ok = 0;
    for (const file of lista) {
      try {
        const novo = await exameArquivosApi.upload(exame.id, file);
        setArquivos((prev) => [...prev, novo]);
        ok++;
      } catch (e: unknown) {
        toast.error(`Não foi possível enviar ${file.name}`, { description: (e as Error).message });
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (ok) {
      setAlterou(true);
      // O envio pode ter mudado o status (realizado → aguardando laudo) e a versão do exame
      await recarregarExame(exame.id);
      toast.success(ok === 1 ? "Arquivo anexado ao exame" : `${ok} arquivos anexados ao exame`);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function removerArquivo(a: ExameArquivo) {
    if (!exame) return;
    if (!confirm(`Tirar "${a.nome_original || "arquivo"}" deste exame? O arquivo continua guardado no prontuário, mas deixa de aparecer aqui.`)) return;
    try {
      await exameArquivosApi.remove(exame.id, a.id);
      setArquivos((prev) => prev.filter((x) => x.id !== a.id));
      setAlterou(true);
      toast.success("Arquivo retirado do exame");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Erro ao retirar o arquivo");
    }
  }

  function fechar(open: boolean) {
    // Arquivos são gravados na hora do envio: a lista de exames precisa recarregar mesmo sem "Salvar"
    if (!open && alterou) onSaved();
    onOpenChange(open);
  }

  async function handleSave() {
    if (!exame) return;
    setSaving(true);
    try {
      const payload: ExameUpdate = { updated_at_esperado: exame.updated_at };
      if (!finalizado) payload.laudo_texto = laudo.trim() || null;
      if (exame.arquivo_url && !legadoUrl) payload.arquivo_url = null;
      if (Object.keys(payload).length === 1) { fechar(false); return; }
      await examesApi.update(exame.id, payload);
      toast.success(finalizado ? "Exame salvo" : "Rascunho do laudo salvo");
      onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Erro ao salvar laudo");
    } finally {
      setSaving(false);
    }
  }

  async function finalizar() {
    if (!exame) return;
    if (!laudo.trim()) { toast.error("Escreva o laudo antes de finalizar"); return; }
    if (!confirm("Finalizar o laudo? Ele fica registrado em seu nome, com data e hora, e o exame passa a Concluído. Para corrigir depois, será preciso reabrir.")) return;
    setAcao("finalizar");
    try {
      const atualizado = await examesApi.finalizarLaudo(exame.id, laudo.trim(), exame.updated_at);
      setAlterou(true);
      await recarregarExame(atualizado.id);
      toast.success("Laudo finalizado");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Erro ao finalizar o laudo");
    } finally {
      setAcao(null);
    }
  }

  async function reabrir() {
    if (!exame) return;
    if (!confirm("Reabrir o laudo para correção? A assinatura atual é retirada e o exame volta para Aguardando laudo até ser finalizado de novo.")) return;
    setAcao("reabrir");
    try {
      await examesApi.reabrirLaudo(exame.id);
      setAlterou(true);
      await recarregarExame(exame.id);
      toast.success("Laudo reaberto para correção");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Erro ao reabrir o laudo");
    } finally {
      setAcao(null);
    }
  }

  function imprimir() {
    if (!exame) return;
    const ok = imprimirLaudo({ ...exame, laudo_texto: finalizado ? exame.laudo_texto : laudo }, imagens);
    if (!ok) toast.error("Não foi possível preparar a impressão neste navegador.");
  }

  const titulo = `${exame.codigo ?? ""} · ${exame.tipo_nome}`;

  return (
    <>
      <Dialog open={!!exame && !verId} onOpenChange={fechar}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Laudo e imagens do exame</DialogTitle>
            <DialogDescription>
              {exame.codigo} · {exame.tipo_nome} · {exame.paciente_nome || "Sem paciente"} · {STATUS_LABELS[exame.status]}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="laudo-texto">Laudo</Label>
                {finalizado ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    Finalizado por {exame.laudado_por_nome || "usuário"} em {new Date(exame.laudado_em as string).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                ) : exame.laudo_texto ? (
                  <span className="text-xs text-amber-700 dark:text-amber-300">Rascunho (ainda não finalizado)</span>
                ) : null}
              </div>
              <Textarea
                id="laudo-texto"
                rows={10}
                value={laudo}
                readOnly={finalizado}
                aria-describedby={finalizado ? "laudo-finalizado-aviso" : undefined}
                onChange={(e) => setLaudo(e.target.value)}
                placeholder="Descreva os achados radiográficos, impressão diagnóstica e recomendações..."
                className={finalizado ? "bg-muted/40" : undefined}
              />
              {finalizado && (
                <p id="laudo-finalizado-aviso" className="text-xs text-muted-foreground">
                  Laudo finalizado não pode ser editado. Para corrigir, use "Reabrir laudo".
                </p>
              )}
            </div>

            <section className="space-y-2" aria-labelledby="exame-arquivos-titulo">
              <div className="flex items-center justify-between gap-2">
                <h3 id="exame-arquivos-titulo" className="text-sm font-medium">Imagens e arquivos</h3>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
                  {uploading > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading > 0 ? `Enviando (${uploading})...` : "Anexar"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                JPG, PNG, WEBP, PDF, DICOM (.dcm) ou ZIP, até 64 MB cada. O arquivo é gravado no exame assim que termina de enviar
                e só abre para quem é da clínica.
              </p>

              {arquivosEstado === "carregando" && (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando arquivos...</div>
              )}
              {arquivosEstado === "erro" && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive" role="alert">
                  Não foi possível carregar os arquivos do exame ({arquivosErro}).
                  <Button size="sm" variant="outline" onClick={carregarArquivos}>Tentar de novo</Button>
                </div>
              )}
              {arquivosEstado === "ok" && arquivos.length === 0 && !legadoUrl && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading > 0}
                  className="w-full rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground hover:border-primary/50 hover:bg-muted/40 transition-colors flex flex-col items-center gap-2"
                >
                  <Upload className="h-5 w-5" />
                  Nenhuma imagem ainda. Clique para anexar a radiografia, tomografia ou PDF.
                </button>
              )}
              {arquivos.length > 0 && (
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {arquivos.map((a) => (
                    <li key={a.id} className="rounded-md border border-border overflow-hidden">
                      {a.imagem ? (
                        <button type="button" onClick={() => setVerId(a.id)} className="block w-full bg-black" aria-label={`Abrir ${a.nome_original || "imagem"} no visualizador`}>
                          <img src={urlArquivoExame(a.url)} alt="" className="h-28 w-full object-contain" loading="lazy" />
                        </button>
                      ) : (
                        <a href={urlArquivoExame(a.url)} target="_blank" rel="noreferrer"
                          className="flex h-28 w-full flex-col items-center justify-center gap-1 bg-muted text-xs text-muted-foreground hover:text-foreground">
                          <FileText className="h-6 w-6" />
                          {a.mime_type === "application/pdf" ? "Abrir PDF" : "Arquivo"}
                        </a>
                      )}
                      <div className="flex items-center gap-1 p-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs" title={a.nome_original ?? undefined}>{a.nome_original || "arquivo"}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {a.descricao ? `${a.descricao} · ` : ""}{formatarTamanho(a.tamanho_bytes)} · {new Date(a.created_at).toLocaleDateString("pt-BR")}
                          </div>
                        </div>
                        <Button asChild size="icon" variant="ghost" className="h-8 w-8">
                          <a href={urlArquivoExame(a.url_download)} rel="noreferrer" aria-label={`Baixar ${a.nome_original || "arquivo"}`}>
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removerArquivo(a)} aria-label={`Tirar ${a.nome_original || "arquivo"} do exame`}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {legadoUrl && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-xs text-muted-foreground">
                      Arquivo enviado pela versão anterior, guardado com link aberto. Para proteger, baixe-o, anexe de novo
                      pelo botão Anexar e depois desvincule este.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                    <span className="truncate flex-1 min-w-0">{legadoNome}</span>
                    {legadoResolvido && (
                      <Button asChild size="sm" variant="outline" className="gap-1">
                        <a href={legadoResolvido} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" /> Abrir
                        </a>
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setLegadoUrl(null)}>Desvincular ao salvar</Button>
                  </div>
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                accept={ACEITOS}
                onChange={(e) => handleFiles(e.target.files)}
              />
            </section>

          </div>

          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-1" onClick={imprimir} disabled={!laudo.trim() && imagens.length === 0}>
                <Printer className="h-4 w-4" /> Imprimir / PDF
              </Button>
              {finalizado && (
                <Button variant="ghost" className="gap-1" onClick={reabrir} disabled={acao !== null}>
                  {acao === "reabrir" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reabrir laudo
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => fechar(false)}>Fechar</Button>
              {!finalizado && (
                <Button variant="outline" onClick={handleSave} disabled={saving || uploading > 0 || acao !== null} className="gap-1">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar rascunho
                </Button>
              )}
              {podeFinalizar && (
                <Button onClick={finalizar} disabled={saving || uploading > 0 || acao !== null || !laudo.trim()} className="gap-1">
                  {acao === "finalizar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Finalizar laudo
                </Button>
              )}
              {finalizado && legadoUrl !== (exame.arquivo_url ?? null) && (
                <Button onClick={handleSave} disabled={saving} className="gap-1">
                  <FileText className="h-4 w-4" /> Salvar
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExameImagemViewer
        imagens={imagens}
        inicialId={verId}
        titulo={titulo}
        onOpenChange={(o) => { if (!o) setVerId(null); }}
        onLinkExpirado={carregarArquivos}
      />
    </>
  );
}
