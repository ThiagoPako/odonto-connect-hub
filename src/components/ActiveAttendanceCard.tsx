import { Clock, MessageSquare, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

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
      className={`group bg-card rounded-2xl border p-5 transition-all duration-300 shadow-card hover:shadow-card-hover relative overflow-hidden ${
        isIdle ? "border-destructive/40 pulse-danger" : "border-border/60"
      }`}
    >
      {/* Status indicator line */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${
        isIdle ? "bg-destructive" : "gradient-primary"
      }`} />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-dental-cyan/15 flex items-center justify-center text-xs font-bold text-dental-cyan">
            {patientInitials}
          </div>
          <div>
            <p className="text-sm font-semibold text-card-foreground">{patientName}</p>
            <p className="text-[10px] text-muted-foreground">Paciente</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center text-[10px] font-bold text-white">
            {attendantInitials}
          </div>
          <span className="text-[11px] text-muted-foreground font-medium">{attendantName}</span>
        </div>
      </div>

      <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-xl bg-muted/40 border border-border/30">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground truncate italic">"{lastMessage}"</p>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className={`h-4 w-4 ${isIdle ? "text-destructive" : "text-muted-foreground/60"}`} />
          <span className={`text-sm font-mono font-semibold ${isIdle ? "text-destructive" : "text-foreground"}`}>
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
        {isIdle && (
          <span className="text-[10px] font-bold text-destructive uppercase tracking-wider bg-destructive/10 px-2.5 py-1 rounded-full">
            Lead Ocioso
          </span>
        )}
        <Link
          to="/chat"
          search={{ lead: patientName }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold text-primary bg-primary/10 hover:bg-primary/15 transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          Abrir Chat
        </Link>
      </div>
    </div>
  );
}
