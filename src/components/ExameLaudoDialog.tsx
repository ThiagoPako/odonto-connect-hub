import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, ExternalLink, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  examesApi, exameArquivosApi, formatarTamanho, urlArquivoExame, STATUS_LABELS,
  type Exame, type ExameArquivo,
} from "@/lib/examesApi";
import { resolveMediaUrl } from "@/lib/vpsApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExameImagemViewer } from "@/components/ExameImagemViewer";

const PENDING_STATUS: Exame["status"][] = ["novo", "em_andamento", "aguardando_laudo"];
const ACEITOS = "image/jpeg,image/png,image/webp,image/gif,image/bmp,application/pdf,.dcm,application/dicom,.zip,application/zip";

interface Props {
  exame: Exame | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ExameLaudoDialog({ exame, onOpenChange, onSaved }: Props) {
  const [laudo, setLaudo] = useState("");
  const [legadoUrl, setLegadoUrl] = useState<string | null>(null);
  const [concluir, setConcluir] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [arquivos, setArquivos] = useState<ExameArquivo[]>([]);
  const [arquivosEstado, setArquivosEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [arquivosErro, setArquivosErro] = useState<string | null>(null);
  const [verId, setVerId] = useState<string | null>(null);
  const [enviouArquivo, setEnviouArquivo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exameId = exame?.id ?? null;

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
    if (!exame) return;
    setLaudo(exame.laudo_texto ?? "");
    setLegadoUrl(exame.arquivo_url ?? null);
    setConcluir(false);
    setVerId(null);
    setEnviouArquivo(false);
    setArquivos([]);
    carregarArquivos();
  }, [exame, carregarArquivos]);

  if (!exame) return null;

  const podeConcluir = PENDING_STATUS.includes(exame.status);
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
      setEnviouArquivo(true);
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
      setEnviouArquivo(true);
      toast.success("Arquivo retirado do exame");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Erro ao retirar o arquivo");
    }
  }

  function fechar(open: boolean) {
    // Arquivos são gravados na hora do envio: a lista de exames precisa recarregar mesmo sem "Salvar"
    if (!open && enviouArquivo) onSaved();
    onOpenChange(open);
  }

  async function handleSave() {
    if (!exame) return;
    setSaving(true);
    try {
      const payload: Partial<Exame> = { laudo_texto: laudo.trim() || null };
      if (exame.arquivo_url && !legadoUrl) payload.arquivo_url = null;
      if (concluir && podeConcluir) {
        payload.status = "concluido";
        if (!exame.data_realizacao) payload.data_realizacao = new Date().toISOString();
      }
      await examesApi.update(exame.id, payload);
      toast.success("Laudo salvo");
      onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Erro ao salvar laudo");
    } finally {
      setSaving(false);
    }
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
              <Label htmlFor="laudo-texto">Laudo</Label>
              <Textarea
                id="laudo-texto"
                rows={10}
                value={laudo}
                onChange={(e) => setLaudo(e.target.value)}
                placeholder="Descreva os achados radiográficos, impressão diagnóstica e recomendações..."
              />
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
                            {formatarTamanho(a.tamanho_bytes)} · {new Date(a.created_at).toLocaleDateString("pt-BR")}
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

            {podeConcluir && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={concluir} onChange={(e) => setConcluir(e.target.checked)} />
                Marcar exame como concluído ao salvar
              </label>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => fechar(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || uploading > 0} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Salvar laudo
            </Button>
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
