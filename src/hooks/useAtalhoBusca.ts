import { useEffect, useState } from "react";

/** Mac/iPhone/iPad usam ⌘; Windows/Linux/Android usam Ctrl. */
function ehApple(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const plataforma = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(plataforma);
}

/**
 * Texto do atalho da busca global para o sistema de quem está usando ("⌘K" ou "Ctrl+K").
 * Começa em "Ctrl+K" e ajusta depois de montar, para o HTML do servidor bater com o do navegador.
 */
export function useAtalhoBusca(): string {
  const [atalho, setAtalho] = useState("Ctrl+K");
  useEffect(() => {
    if (ehApple()) setAtalho("⌘K");
  }, []);
  return atalho;
}
