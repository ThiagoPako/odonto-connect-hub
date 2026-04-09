import { Bell, Search, CalendarDays } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";

export function DashboardHeader({ title }: { title: string }) {
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
      <header className="h-[72px] flex items-center justify-between px-8 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-20">
        <div>
          <h1 className="text-lg font-bold text-foreground tracking-tight">{title}</h1>
          {today && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <CalendarDays className="h-3 w-3" />
              <span className="capitalize">{today}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="relative group flex items-center h-10 pl-10 pr-4 rounded-xl bg-muted/60 border border-border/50 text-sm text-muted-foreground hover:bg-muted/80 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/30 w-72 transition-all cursor-pointer"
            aria-label="Buscar no sistema"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            <span>Buscar paciente, orçamento...</span>
            <kbd className="ml-auto pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </button>
          <button
            className="relative p-2.5 rounded-xl hover:bg-muted/80 transition-all group"
            aria-label="Notificações"
          >
            <Bell className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
          </button>
          <div
            className="h-10 w-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground text-sm font-bold shadow-sm cursor-pointer hover:scale-105 transition-transform"
            title={user?.name || "Usuário"}
          >
            {initials}
          </div>
        </div>
      </header>
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
