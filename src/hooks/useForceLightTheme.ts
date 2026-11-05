import { useEffect } from "react";

/**
 * Páginas públicas (landing, login, cadastro) usam sempre o tema claro: o
 * logotipo tem texto azul-marinho e some no fundo escuro. Ao sair da página,
 * o tema escolhido pelo usuário (classe .dark) volta como estava.
 */
export function useForceLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      let pref: string | null = null;
      try { pref = localStorage.getItem("odonto-theme"); } catch { /* ignora */ }
      const sistemaEscuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const escuro = pref === "dark" || ((pref === "system" || pref === null) && sistemaEscuro);
      if (escuro || (wasDark && pref !== "light")) root.classList.add("dark");
    };
  }, []);
}
