import { Bell, Search, CalendarDays } from "lucide-react";
import { useState, useEffect } from "react";

export function DashboardHeader({ title }: { title: string }) {
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    );
  }, []);

  return (
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
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <input
            type="text"
            placeholder="Buscar paciente, orçamento..."
            className="h-10 pl-10 pr-4 rounded-xl bg-muted/60 border border-border/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:bg-card w-72 transition-all"
          />
        </div>
        <button className="relative p-2.5 rounded-xl hover:bg-muted/80 transition-all group">
          <Bell className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
        </button>
        <div className="h-10 w-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground text-sm font-bold shadow-sm cursor-pointer hover:scale-105 transition-transform">
          DC
        </div>
      </div>
    </header>
  );
}
