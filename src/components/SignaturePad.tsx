/**
 * SignaturePad — captura assinatura via Canvas (mouse/touch/pen) + geolocalização.
 * Conformidade MP 2200-2/2001 (assinatura eletrônica): exporta PNG base64
 * com latitude/longitude/accuracy do navegador.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, RotateCcw, AlertTriangle } from "lucide-react";

export interface SignatureResult {
  base64: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
}

interface Props {
  onChange?: (hasSignature: boolean) => void;
  height?: number;
  /** chame esse ref via parent para recuperar a assinatura final */
  signatureRef?: React.MutableRefObject<(() => SignatureResult | null) | null>;
}

export function SignaturePad({ onChange, height = 180, signatureRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  // Inicializa canvas em alta resolução
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0f172a";
  }, []);

  // Pede geolocalização ao montar
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError("Geolocalização não suportada pelo navegador");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGeoLoading(false);
      },
      (err) => {
        setGeoError(err.message || "Não foi possível obter localização");
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }, []);

  // Expõe getter
  useEffect(() => {
    if (!signatureRef) return;
    signatureRef.current = (): SignatureResult | null => {
      const canvas = canvasRef.current;
      if (!canvas || !hasInk) return null;
      return {
        base64: canvas.toDataURL("image/png"),
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        accuracy: geo?.accuracy ?? null,
      };
    };
  }, [signatureRef, hasInk, geo]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    drawing.current = true;
    last.current = getPos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  };
  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    last.current = { x, y };
    if (!hasInk) {
      setHasInk(true);
      onChange?.(true);
    }
  };
  const endDraw = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange?.(false);
  };

  return (
    <div className="space-y-2">
      <div
        className="relative rounded-lg border-2 border-dashed border-border bg-background overflow-hidden"
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none cursor-crosshair"
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={endDraw}
          onPointerCancel={endDraw}
          onPointerLeave={endDraw}
        />
        {!hasInk && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground text-xs">
            Assine aqui com o dedo, mouse ou caneta
          </div>
        )}
        {hasInk && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clear}
            className="absolute top-1 right-1 h-7 px-2 text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Geo status */}
      <div className="flex items-center gap-2 text-[11px]">
        {geoLoading && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Obtendo localização...
          </span>
        )}
        {geo && (
          <span className="flex items-center gap-1 text-success">
            <MapPin className="h-3 w-3" />
            {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)} (~{Math.round(geo.accuracy)}m)
          </span>
        )}
        {geoError && (
          <span className="flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3 w-3" /> {geoError}
          </span>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Esta assinatura é registrada eletronicamente conforme MP 2200-2/2001
        (validade jurídica plena entre as partes).
      </p>
    </div>
  );
}
