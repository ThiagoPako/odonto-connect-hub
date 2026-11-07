import { Bell, Search, CalendarDays, LucideIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";

export function DashboardHeader({ title, icon: Icon }: { title: string; icon?: LucideIcon }) {
  const { user } = useAuth();
  const [today, setToday] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    );
  }, []);

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "??";

  return (
    <>
      {/* min-h em vez de altura fixa: título longo quebra linha em vez de ser cortado.
          No celular a busca vira só ícone e o menu fica na barra superior do shell. */}
      <header className="min-h-16 md:min-h-[72px] flex items-center justify-between gap-3 px-4 py-3 md:px-6 lg:px-8 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {Icon && (
            <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold text-foreground tracking-tight leading-snug text-pretty break-words">{title}</h1>
            {today && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <CalendarDays className="h-3 w-3 shrink-0" />
                <span className="first-letter:uppercase">{today}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="relative group flex items-center justify-center md:justify-start h-10 w-10 md:w-56 lg:w-72 md:pl-10 md:pr-3 rounded-xl bg-muted/60 border border-border/50 text-sm text-muted-foreground hover:bg-muted/80 hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors cursor-pointer"
            aria-label="Buscar no sistema"
          >
            <Search className="md:absolute md:left-3 md:top-1/2 md:-translate-y-1/2 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
            <span className="hidden md:inline min-w-0 flex-1 text-left leading-tight">
              Buscar<span className="hidden lg:inline"> paciente, orçamento...</span>
            </span>
            <kbd className="pointer-events-none hidden lg:inline-flex h-5 shrink-0 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            className="relative h-10 w-10 inline-flex items-center justify-center rounded-xl hover:bg-muted/80 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Notificações"
          >
            <Bell className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
          <Link
            to="/perfil"
            className="hidden sm:flex h-10 w-10 shrink-0 rounded-xl gradient-primary items-center justify-center text-primary-foreground text-sm font-bold shadow-sm hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            title={user?.name || "Usuário"}
            aria-label={`Meu perfil (${user?.name || "Usuário"})`}
          >
            {initials}
          </Link>
        </div>
      </header>
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
