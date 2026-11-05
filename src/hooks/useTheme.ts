import { useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark";
/** Preferência do usuário. "system" segue o modo claro/escuro do aparelho. */
export type ThemePreference = Theme | "system";

const KEY = "odonto-theme";
const ORDEM: ThemePreference[] = ["system", "light", "dark"];

function readPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "dark" || stored === "light" || stored === "system") return stored;
  } catch {
    /* armazenamento bloqueado: segue o sistema */
  }
  return "system";
}

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<Theme>(systemTheme);

  // Acompanha a troca de modo do sistema enquanto a tela está aberta
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = preference === "system" ? system : preference;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(KEY, preference);
    } catch {
      /* ignora */
    }
  }, [theme, preference]);

  /** Sistema → Claro → Escuro → Sistema */
  const toggleTheme = useCallback(() => {
    setPreference((prev) => ORDEM[(ORDEM.indexOf(prev) + 1) % ORDEM.length]);
  }, []);

  const setTheme = useCallback((t: ThemePreference) => setPreference(t), []);

  return { theme, preference, toggleTheme, setTheme, isDark: theme === "dark" };
}
