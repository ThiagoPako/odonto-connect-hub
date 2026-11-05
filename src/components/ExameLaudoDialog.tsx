import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { examesApi, STATUS_LABELS, type Exame } from "@/lib/examesApi";
import { mediaApi, resolveMediaUrl } from "@/lib/vpsApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const PENDING_STATUS: Exame["status"][] = ["novo", "em_andamento", "aguardando_laudo"];

interface Props {
  exame: Exame | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ExameLaudoDialog({ exame, onOpenChange, onSaved }: Props) {
  const [laudo, setLaudo] = useState("");
  const [arquivoUrl, setArquivoUrl] = useState<string | null>(null);
  const [concluir, setConcluir] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!exame) return;
    setLaudo(exame.laudo_texto ?? "");
    setArquivoUrl(exame.arquivo_url ?? null);
    setConcluir(false);
  }, [exame]);

  if (!exame) return null;

  const podeConcluir = PENDING_STATUS.includes(exame.status);
  const resolvedUrl = resolveMediaUrl(arquivoUrl);
  const isImage = !!arquivoUrl && IMAGE_EXT.test(arquivoUrl);
  const fileName = arquivoUrl?.split("/").pop() ?? "";

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const { url, error } = await mediaApi.upload(file);
      if (error || !url) throw new Error(error || "sem URL");
      setArquivoUrl(url);
      toast.success("Arquivo enviado. Clique em Salvar para gravar no exame.");
    } catch (e: unknown) {
      toast.error(`Falha ao enviar arquivo: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!exame) return;
    setSaving(true);
    try {
      const payload: Partial<Exame> = {
        laudo_texto: laudo.trim() || null,
        arquivo_url: arquivoUrl,
      };
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

  return (
    <Dialog open={!!exame} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Laudo e imagem do exame</DialogTitle>
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

          <div className="space-y-2">
            <Label>Imagem / arquivo final</Label>
            {arquivoUrl ? (
              <div className="rounded-lg border border-border p-3 space-y-3">
                {isImage && resolvedUrl && (
                  <a href={resolvedUrl} target="_blank" rel="noreferrer">
                    <img
                      src={resolvedUrl}
                      alt={`Imagem do exame ${exame.codigo ?? ""}`}
                      className="max-h-64 w-full object-contain rounded bg-muted"
                    />
                  </a>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{fileName}</span>
                  {resolvedUrl && (
                    <Button asChild size="sm" variant="outline" className="gap-1">
                      <a href={resolvedUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" /> Abrir
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    Trocar
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setArquivoUrl(null)} aria-label="Remover arquivo">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground hover:border-primary/50 hover:bg-muted/40 transition-colors flex flex-col items-center gap-2"
              >
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                {uploading ? "Enviando..." : "Enviar imagem, PDF ou arquivo do exame (até 64 MB)"}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf,.dcm,.zip"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          {podeConcluir && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={concluir} onChange={(e) => setConcluir(e.target.checked)} />
              Marcar exame como concluído ao salvar
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || uploading} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Salvar laudo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
