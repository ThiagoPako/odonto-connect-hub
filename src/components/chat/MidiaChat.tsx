import { Download, Loader2 } from "lucide-react";
import { useMidiaAssinada } from "@/lib/midiaAssinada";

/** Placeholder quando a mídia não pôde ser carregada nem renovada. */
export function MidiaIndisponivel({ rotulo }: { rotulo: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-4 rounded-xl bg-background/15 mb-1.5 border border-border/20">
      <div className="h-10 w-10 rounded-full bg-muted/30 flex items-center justify-center shrink-0">
        <Download className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">{rotulo}</p>
        <p className="text-[10px] text-muted-foreground">Mídia indisponível. Peça ao paciente para reenviar, se precisar.</p>
      </div>
    </div>
  );
}

export function ChatImagem({ url, nome, enviando, onAbrir }: {
  url: string;
  nome?: string;
  enviando?: boolean;
  /** Abre o visualizador com o link já renovado. */
  onAbrir?: (src: string) => void;
}) {
  const { src, onError, indisponivel, renovando } = useMidiaAssinada(url);
  if (indisponivel || !src) return <MidiaIndisponivel rotulo="📷 Imagem" />;
  return (
    <img
      src={src}
      alt={nome || "Imagem"}
      className={`max-w-full max-h-[300px] object-contain rounded-xl transition-opacity ${enviando || renovando ? "opacity-60" : ""}`}
      loading="lazy"
      onError={onError}
      onClick={() => { if (!enviando && onAbrir) onAbrir(src); }}
    />
  );
}

export function ChatVideo({ url, enviando }: { url: string; enviando?: boolean }) {
  const { src, onError, indisponivel } = useMidiaAssinada(url);
  if (indisponivel || !src) return <MidiaIndisponivel rotulo="🎬 Vídeo" />;
  return (
    <video
      src={src}
      controls={!enviando}
      preload="metadata"
      className={`max-w-full max-h-[300px] rounded-xl transition-opacity ${enviando ? "opacity-60" : ""}`}
      onError={onError}
    />
  );
}

export function ChatFigurinha({ url }: { url: string }) {
  const { src, onError, indisponivel } = useMidiaAssinada(url);
  if (indisponivel || !src) return <MidiaIndisponivel rotulo="Figurinha" />;
  return <img src={src} alt="Figurinha" className="max-w-[150px] max-h-[150px]" loading="lazy" onError={onError} />;
}

/** Imagem do visualizador em tela cheia (também renova o link uma vez). */
export function ImagemVisualizador({ url, nome, className, style }: {
  url: string;
  nome: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { src, onError, indisponivel } = useMidiaAssinada(url);
  if (indisponivel || !src) {
    return <p role="status" className="text-sm text-white/80">Mídia indisponível.</p>;
  }
  return <img src={src} alt={nome} className={className} draggable={false} style={style} onError={onError} />;
}

/** Documento: ao clicar, garante link válido (renova se venceu) antes de abrir. */
export function ChatDocumento({ url, nome, mime, enviando }: { url?: string; nome?: string; mime?: string; enviando?: boolean }) {
  const { linkAtual, indisponivel, renovando } = useMidiaAssinada(url);
  const abrir = async () => {
    if (enviando || !url) return;
    // Abre a aba já no clique (senão o navegador bloqueia o pop-up depois do await)
    const aba = window.open("", "_blank");
    const link = await linkAtual();
    if (link && aba) { aba.opener = null; aba.location.href = link; }
    else aba?.close();
  };
  if (indisponivel) return <MidiaIndisponivel rotulo={`📄 ${nome || "Documento"}`} />;
  return (
    <button
      type="button"
      onClick={() => void abrir()}
      className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl bg-background/15 mb-1.5 border border-border/20 cursor-pointer hover:bg-background/25 transition-colors"
    >
      <div className="h-11 w-11 rounded-xl bg-primary/20 flex items-center justify-center text-lg shrink-0 shadow-sm">
        {enviando || renovando ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : "📄"}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold truncate">{nome || "Documento"}</p>
        <p className="text-[10px] opacity-60 mt-0.5">{enviando ? "Enviando..." : (mime || "application/pdf")}</p>
      </div>
    </button>
  );
}
