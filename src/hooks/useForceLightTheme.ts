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
      if (wasDark || localStorage.getItem("odonto-theme") === "dark") root.classList.add("dark");
    };
  }, []);
}
