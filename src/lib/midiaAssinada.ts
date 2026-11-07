/**
 * Mídia do chat por link assinado (L7, #81): os links de /uploads/media vencem (1 h por padrão).
 * Quando um <img>/<audio>/<video> falha ou o link está perto de vencer, pedimos um link novo
 * ao servidor (POST /api/media/sign, via mediaApi.renovarLinks) e trocamos o src.
 *
 * - Pedidos de várias mídias ao mesmo tempo são juntados em lotes de no máximo 20 caminhos.
 * - Cada mídia tenta renovar UMA vez depois de um erro; se falhar de novo, a tela mostra
 *   "mídia indisponível" (sem loop).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mediaApi, resolveMediaUrl } from "@/lib/vpsApi";
import {
  configurarRenovacaoDeMidia, ehMidiaNossa, expiracaoDoLink, linkPertoDeVencer, renovarLinkMidia, MIDIA_MARGEM_S,
} from "./midiaAssinadaNucleo";

export { ehMidiaNossa, expiracaoDoLink, linkPertoDeVencer, renovarLinkMidia } from "./midiaAssinadaNucleo";

configurarRenovacaoDeMidia(mediaApi.renovarLinks, (u) => resolveMediaUrl(u) ?? u);

/**
 * src de uma mídia com renovação automática:
 * - perto de vencer (ou quando chega a hora): renova antes;
 * - `onError`: tenta renovar uma única vez; se não der, `indisponivel = true`.
 * URLs que não são nossas (ex.: foto do WhatsApp) só marcam `indisponivel` no erro.
 */
export function useMidiaAssinada(original?: string | null) {
  const [src, setSrc] = useState<string | undefined>(original || undefined);
  const [indisponivel, setIndisponivel] = useState(false);
  const [renovando, setRenovando] = useState(false);
  const tentouRef = useRef(false);

  useEffect(() => {
    setSrc(original || undefined);
    setIndisponivel(false);
    tentouRef.current = false;
  }, [original]);

  // Renovação antes de vencer: agenda para (exp - 2 min); se já está nessa janela, renova agora.
  useEffect(() => {
    if (!src || !ehMidiaNossa(src)) return;
    const exp = expiracaoDoLink(src);
    if (!exp) return;
    let vivo = true;
    const ms = Math.max(0, exp * 1000 - MIDIA_MARGEM_S * 1000 - Date.now());
    const t = setTimeout(() => {
      void renovarLinkMidia(src).then((novo) => { if (vivo && novo && novo !== src) setSrc(novo); });
    }, ms);
    return () => { vivo = false; clearTimeout(t); };
  }, [src]);

  const onError = useCallback(() => {
    if (!src || !ehMidiaNossa(src) || tentouRef.current) {
      setIndisponivel(true);
      return;
    }
    tentouRef.current = true;
    setRenovando(true);
    void renovarLinkMidia(src).then((novo) => {
      setRenovando(false);
      if (novo && novo !== src) setSrc(novo);
      else setIndisponivel(true);
    });
  }, [src]);

  /** Link válido agora (renova se vencido/perto de vencer); para abrir documento em nova aba. */
  const linkAtual = useCallback(async (): Promise<string | null> => {
    if (!src) return null;
    if (!ehMidiaNossa(src)) return src;
    if (expiracaoDoLink(src) && !linkPertoDeVencer(src)) return src;
    const novo = await renovarLinkMidia(src);
    if (novo) setSrc(novo);
    return novo;
  }, [src]);

  return { src, onError, indisponivel, renovando, linkAtual };
}
