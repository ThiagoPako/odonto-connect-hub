import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

interface ActiveAttendanceCardProps {
  patientName: string;
  patientInitials: string;
  attendantName: string;
  attendantInitials: string;
  lastMessage: string;
  startedAt: Date;
}

export function ActiveAttendanceCard({
  patientName,
  patientInitials,
  attendantName,
  attendantInitials,
  lastMessage,
  startedAt,
}: ActiveAttendanceCardProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const isIdle = minutes >= 5;

  return (
    <div
      className={`bg-card rounded-xl border p-4 transition-all ${
        isIdle ? "border-destructive pulse-danger" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-dental-cyan/20 flex items-center justify-center text-xs font-bold text-dental-cyan">
            {patientInitials}
          </div>
          <div>
            <p className="text-sm font-medium text-card-foreground">{patientName}</p>
            <p className="text-xs text-muted-foreground">Paciente</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
            {attendantInitials}
          </div>
          <span className="text-xs text-muted-foreground">{attendantName}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground truncate mb-3">"{lastMessage}"</p>

      <div className="flex items-center gap-1.5">
        <Clock className={`h-3.5 w-3.5 ${isIdle ? "text-destructive" : "text-muted-foreground"}`} />
        <span className={`text-xs font-mono font-medium ${isIdle ? "text-destructive" : "text-muted-foreground"}`}>
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </span>
        {isIdle && (
          <span className="ml-2 text-[10px] font-semibold text-destructive uppercase tracking-wide">
            Lead Ocioso
          </span>
        )}
      </div>
    </div>
  );
}
