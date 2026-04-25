import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  currentDate: Date;
  onChange: (d: Date) => void;
}

const DOW = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function AgendaMiniCalendar({ currentDate, onChange }: Props) {
  const { year, month, days, today } = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const first = new Date(y, m, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const arr: { day: number | null; date?: Date }[] = [];
    for (let i = 0; i < startWeekday; i++) arr.push({ day: null });
    for (let d = 1; d <= daysInMonth; d++) arr.push({ day: d, date: new Date(y, m, d) });
    while (arr.length % 7 !== 0) arr.push({ day: null });
    const t = new Date();
    return { year: y, month: m, days: arr, today: t };
  }, [currentDate]);

  const prev = () => onChange(new Date(year, month - 1, 1));
  const next = () => onChange(new Date(year, month + 1, 1));

  const isSelected = (d?: Date) =>
    !!d &&
    d.getFullYear() === currentDate.getFullYear() &&
    d.getMonth() === currentDate.getMonth() &&
    d.getDate() === currentDate.getDate();

  const isToday = (d?: Date) =>
    !!d &&
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  return (
    <div className="bg-card rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prev}
          className="h-7 w-7 rounded hover:bg-muted inline-flex items-center justify-center"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-semibold uppercase tracking-wide text-foreground">
          {MONTHS[month]} <span className="text-muted-foreground font-normal">{year}</span>
        </div>
        <button
          onClick={next}
          className="h-7 w-7 rounded hover:bg-muted inline-flex items-center justify-center"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground mb-1">
        {DOW.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((cell, i) => {
          if (!cell.day) return <div key={i} />;
          const sel = isSelected(cell.date);
          const tod = isToday(cell.date);
          return (
            <button
              key={i}
              onClick={() => cell.date && onChange(cell.date)}
              className={`h-7 w-7 mx-auto rounded text-xs font-medium transition-colors ${
                sel
                  ? "bg-primary text-primary-foreground"
                  : tod
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
