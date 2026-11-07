import { useEffect, useRef, useState } from "react";
import { Columns2, Contrast, Download, Maximize, Minus, Plus, RotateCcw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { urlArquivoExame, type ExameArquivo } from "@/lib/examesApi";

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

interface Props {
  /** Só imagens (o PDF abre na aba do navegador). */
  imagens: ExameArquivo[];
  inicialId: string | null;
  titulo: string;
  onOpenChange: (open: boolean) => void;
  /** Chamado quando um link assinado expira: quem abriu busca links novos. */
  onLinkExpirado?: () => void;
}

/**
 * Visualizador de imagem de exame: zoom (botões, roda do mouse, teclado), arrastar para mover,
 * brilho, contraste, negativo e comparação lado a lado com outra imagem do mesmo exame
 * (zoom, posição e filtros iguais nas duas, para comparar a mesma região).
 */
export function ExameImagemViewer({ imagens, inicialId, titulo, onOpenChange, onLinkExpirado }: Props) {
  const [atualId, setAtualId] = useState<string | null>(inicialId);
  const [comparaId, setComparaId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [brilho, setBrilho] = useState(100);
  const [contraste, setContraste] = useState(100);
  const [negativo, setNegativo] = useState(false);

  useEffect(() => {
    setAtualId(inicialId);
    setComparaId(null);
    redefinir();
  }, [inicialId]);

  const aberto = !!inicialId;
  const atual = imagens.find((i) => i.id === atualId) ?? imagens[0];
  const compara = comparaId ? imagens.find((i) => i.id === comparaId) ?? null : null;
  const outras = imagens.filter((i) => i.id !== atual?.id);

  function redefinir() {
    setZoom(1);
    setPos({ x: 0, y: 0 });
    setBrilho(100);
    setContraste(100);
    setNegativo(false);
  }

  function mudarZoom(fator: number) {
    setZoom((z) => {
      const novo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z * fator).toFixed(2)));
      if (novo === 1) setPos({ x: 0, y: 0 });
      return novo;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    const passo = 40;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); mudarZoom(1.25); }
    else if (e.key === "-") { e.preventDefault(); mudarZoom(0.8); }
    else if (e.key === "0") { e.preventDefault(); redefinir(); }
    else if (zoom > 1 && e.key === "ArrowLeft") { e.preventDefault(); setPos((p) => ({ ...p, x: p.x + passo })); }
    else if (zoom > 1 && e.key === "ArrowRight") { e.preventDefault(); setPos((p) => ({ ...p, x: p.x - passo })); }
    else if (zoom > 1 && e.key === "ArrowUp") { e.preventDefault(); setPos((p) => ({ ...p, y: p.y + passo })); }
    else if (zoom > 1 && e.key === "ArrowDown") { e.preventDefault(); setPos((p) => ({ ...p, y: p.y - passo })); }
  }

  const filtro = `brightness(${brilho}%) contrast(${contraste}%)${negativo ? " invert(1)" : ""}`;

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,1400px)] w-full h-[92vh] flex flex-col gap-3 p-3 sm:p-4" onKeyDown={onKeyDown}>
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base">Imagem do exame</DialogTitle>
          <DialogDescription className="truncate">
            {titulo}{atual?.nome_original ? ` · ${atual.nome_original}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Ferramentas da imagem">
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => mudarZoom(0.8)} disabled={zoom <= ZOOM_MIN} aria-label="Diminuir zoom">
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-14 text-center text-sm tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => mudarZoom(1.25)} disabled={zoom >= ZOOM_MAX} aria-label="Aumentar zoom">
            <Plus className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }); }} aria-label="Ajustar à tela">
            <Maximize className="h-4 w-4" />
          </Button>

          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sun className="h-4 w-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Brilho</span>
            <input type="range" min={30} max={250} value={brilho} onChange={(e) => setBrilho(Number(e.target.value))}
              className="w-24 accent-primary" aria-label="Brilho" aria-valuetext={`${brilho}%`} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Contrast className="h-4 w-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Contraste</span>
            <input type="range" min={30} max={300} value={contraste} onChange={(e) => setContraste(Number(e.target.value))}
              className="w-24 accent-primary" aria-label="Contraste" aria-valuetext={`${contraste}%`} />
          </label>
          <Button size="sm" variant={negativo ? "default" : "outline"} className="h-9" onClick={() => setNegativo((v) => !v)} aria-pressed={negativo}>
            Negativo
          </Button>
          <Button size="sm" variant="ghost" className="h-9 gap-1" onClick={redefinir}>
            <RotateCcw className="h-4 w-4" /> Redefinir
          </Button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {outras.length > 0 && (
              <Select value={comparaId ?? "nenhuma"} onValueChange={(v) => setComparaId(v === "nenhuma" ? null : v)}>
                <SelectTrigger className="h-9 w-[200px]" aria-label="Comparar com outra imagem">
                  <Columns2 className="h-4 w-4 mr-1 shrink-0" />
                  <SelectValue placeholder="Comparar com..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhuma">Sem comparação</SelectItem>
                  {outras.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.nome_original || "Imagem"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {atual && (
              <Button asChild size="sm" variant="outline" className="h-9 gap-1">
                <a href={urlArquivoExame(atual.url_download)} rel="noreferrer">
                  <Download className="h-4 w-4" /> Baixar
                </a>
              </Button>
            )}
          </div>
        </div>

        <div className={cn("grid min-h-0 flex-1 gap-2", compara ? "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1" : "grid-cols-1")}>
          {atual && (
            <PainelImagem arquivo={atual} zoom={zoom} pos={pos} filtro={filtro}
              onZoom={mudarZoom} onMover={setPos} onLinkExpirado={onLinkExpirado} rotulo={compara ? "Imagem atual" : undefined} />
          )}
          {compara && (
            <PainelImagem arquivo={compara} zoom={zoom} pos={pos} filtro={filtro}
              onZoom={mudarZoom} onMover={setPos} onLinkExpirado={onLinkExpirado} rotulo="Comparação" />
          )}
        </div>

        {imagens.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Outras imagens do exame">
            {imagens.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => { setAtualId(i.id); if (comparaId === i.id) setComparaId(null); }}
                aria-label={`Ver ${i.nome_original || "imagem"}`}
                aria-current={i.id === atual?.id}
                className={cn("h-14 w-20 shrink-0 overflow-hidden rounded border bg-black", i.id === atual?.id ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100")}
              >
                <img src={urlArquivoExame(i.url)} alt="" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Atalhos: + e − para zoom, 0 para redefinir, setas para mover. Arraste a imagem com zoom para mover.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function PainelImagem({
  arquivo, zoom, pos, filtro, onZoom, onMover, onLinkExpirado, rotulo,
}: {
  arquivo: ExameArquivo;
  zoom: number;
  pos: { x: number; y: number };
  filtro: string;
  onZoom: (fator: number) => void;
  onMover: (p: { x: number; y: number }) => void;
  onLinkExpirado?: () => void;
  rotulo?: string;
}) {
  const arrasto = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [falhou, setFalhou] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => { setFalhou(false); setCarregando(true); }, [arquivo.url]);

  // Roda do mouse dá zoom (listener não passivo para poder impedir a rolagem da página)
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); onZoom(e.deltaY < 0 ? 1.15 : 0.87); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoom]);

  return (
    <div
      ref={caixa}
      className={cn("relative min-h-0 overflow-hidden rounded-md bg-black select-none touch-none", zoom > 1 ? "cursor-grab active:cursor-grabbing" : "")}
      onPointerDown={(e) => {
        if (zoom <= 1) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        arrasto.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
      }}
      onPointerMove={(e) => {
        if (!arrasto.current) return;
        onMover({ x: arrasto.current.px + (e.clientX - arrasto.current.x), y: arrasto.current.py + (e.clientY - arrasto.current.y) });
      }}
      onPointerUp={() => { arrasto.current = null; }}
      onPointerCancel={() => { arrasto.current = null; }}
      onDoubleClick={() => onZoom(zoom > 1 ? 1 / zoom : 2)}
    >
      {rotulo && (
        <span className="absolute left-2 top-2 z-10 rounded bg-black/70 px-2 py-0.5 text-[11px] text-white">{rotulo}</span>
      )}
      {falhou ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/80" role="alert">
          Não foi possível carregar a imagem. O link pode ter expirado.
          {onLinkExpirado && (
            <Button size="sm" variant="secondary" onClick={onLinkExpirado}>Carregar de novo</Button>
          )}
        </div>
      ) : (
        <>
          {carregando && <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">Carregando imagem...</div>}
          <img
            src={urlArquivoExame(arquivo.url)}
            alt={arquivo.nome_original ? `Imagem do exame: ${arquivo.nome_original}` : "Imagem do exame"}
            draggable={false}
            onLoad={() => setCarregando(false)}
            onError={() => { setFalhou(true); setCarregando(false); }}
            className="h-full w-full object-contain"
            style={{
              filter: filtro,
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: arrasto.current ? "none" : "transform 80ms ease-out",
            }}
          />
        </>
      )}
    </div>
  );
}
