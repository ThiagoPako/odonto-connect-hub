import { Bell, Search, LucideIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";

/**
 * Cabeçalho das telas internas. No computador: título + data, busca larga,
 * notificações e avatar. No celular (< 768 px): título e ícones, sem a data
 * nem a busca larga (que transbordavam a tela). Ver DESIGN.md › Layout.
 */
export function DashboardHeader({ title, icon: Icon }: { title: string; icon?: LucideIcon }) {
  const { user } = useAuth();
  const [today, setToday] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const d = new Date().toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    // "quinta-feira, 5 de novembro" → "Quinta-feira, 5 de novembro"
    setToday(d.charAt(0).toUpperCase() + d.slice(1));
  }, []);

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "??";

  return (
    <>
      <header className="h-14 md:h-16 flex items-center justify-between gap-3 px-4 md:px-8 border-b border-border bg-card sticky top-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && <Icon className="hidden sm:block h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-semibold text-foreground tracking-tight truncate">{title}</h1>
            {today && (
              <p className="hidden md:block text-xs text-muted-foreground leading-tight">{today}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden lg:flex items-center gap-2.5 h-10 w-72 pl-3 pr-2 rounded-md bg-muted border border-transparent text-sm text-muted-foreground hover:border-border transition-colors"
            aria-label="Buscar no sistema"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left truncate">Buscar paciente, orçamento…</span>
            <kbd className="pointer-events-none inline-flex h-6 items-center rounded border border-border bg-card px-1.5 text-[11px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className="lg:hidden flex items-center justify-center h-10 w-10 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Buscar no sistema"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            className="flex items-center justify-center h-10 w-10 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Notificações"
          >
            <Bell className="h-5 w-5" />
          </button>
          <Link
            to="/perfil"
            className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold"
            title={user?.name || "Meu perfil"}
            aria-label="Meu perfil"
          >
            {initials}
          </Link>
        </div>
      </header>
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
