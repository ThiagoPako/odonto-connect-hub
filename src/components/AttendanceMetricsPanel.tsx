import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { metricsApi, type AttendanceMetrics } from "@/lib/vpsApi";
import { Clock, Timer, MessageSquare, Star, Users, TrendingUp, Loader2, RefreshCw } from "lucide-react";

function formatTime(seconds: number | string | null): string {
  if (!seconds) return "—";
  const s = typeof seconds === "string" ? parseInt(seconds, 10) : seconds;
  if (isNaN(s) || s === 0) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= Math.round(rating) ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </div>
  );
}

export function AttendanceMetricsPanel() {
  const [metrics, setMetrics] = useState<AttendanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = async () => {
    setLoading(true);
    const { data } = await metricsApi.attendance(days);
    if (data) setMetrics(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [days]);

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!metrics) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Não foi possível carregar as métricas.
        <Button variant="outline" size="sm" className="ml-2" onClick={load}>Tentar novamente</Button>
      </Card>
    );
  }

  const g = metrics.general;
  const s = metrics.satisfaction;
  const avgRating = s?.avg_rating ? parseFloat(s.avg_rating) : 0;

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Métricas de Atendimento</h3>
        </div>
        <div className="flex items-center gap-2">
          {[7, 15, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                days === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {d}d
            </button>
          ))}
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="Atualizar">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* General KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <MessageSquare className="h-4 w-4 text-blue-500" />
            </div>
            <span className="text-[11px] text-muted-foreground">Total Atendimentos</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{g.total_sessions || 0}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{g.closed_sessions || 0} finalizados</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <span className="text-[11px] text-muted-foreground">Tempo Médio de Espera</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatTime(g.avg_wait_time)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Máx: {formatTime(g.max_wait_time)}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Timer className="h-4 w-4 text-green-500" />
            </div>
            <span className="text-[11px] text-muted-foreground">Tempo 1ª Resposta</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatTime(g.avg_response_time)}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Star className="h-4 w-4 text-purple-500" />
            </div>
            <span className="text-[11px] text-muted-foreground">Avaliação Média</span>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-foreground">{avgRating || "—"}</p>
            {avgRating > 0 && <StarDisplay rating={avgRating} />}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">{s?.total_ratings || 0} avaliações</p>
        </Card>
      </div>

      {/* Satisfaction breakdown */}
      {parseInt(s?.total_ratings || "0") > 0 && (
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-foreground mb-3">Distribuição de Avaliações</h4>
          <div className="space-y-1.5">
            {[
              { label: "5 ⭐", count: parseInt(s.five_star), color: "bg-green-500" },
              { label: "4 ⭐", count: parseInt(s.four_star), color: "bg-lime-500" },
              { label: "3 ⭐", count: parseInt(s.three_star), color: "bg-amber-500" },
              { label: "2 ⭐", count: parseInt(s.two_star), color: "bg-orange-500" },
              { label: "1 ⭐", count: parseInt(s.one_star), color: "bg-red-500" },
            ].map((row) => {
              const total = parseInt(s.total_ratings);
              const pct = total > 0 ? (row.count / total) * 100 : 0;
              return (
                <div key={row.label} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-8">{row.label}</span>
                  <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${row.color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] text-muted-foreground w-8 text-right">{row.count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Per attendant table */}
      {metrics.perAttendant.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-primary" />
            <h4 className="text-xs font-semibold text-foreground">Por Atendente</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 font-medium">Atendente</th>
                  <th className="text-center py-2 font-medium">Sessões</th>
                  <th className="text-center py-2 font-medium">T. Espera</th>
                  <th className="text-center py-2 font-medium">T. Resposta</th>
                  <th className="text-center py-2 font-medium">Duração</th>
                  <th className="text-center py-2 font-medium">Avaliação</th>
                </tr>
              </thead>
              <tbody>
                {metrics.perAttendant.map((a) => {
                  const satData = metrics.satisfactionPerAttendant.find((s) => s.attendant_id === a.attendant_id);
                  return (
                    <tr key={a.attendant_id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 font-medium text-foreground">{a.attendant_name}</td>
                      <td className="py-2 text-center text-muted-foreground">{a.total_sessions}</td>
                      <td className="py-2 text-center text-muted-foreground">{formatTime(a.avg_wait_time)}</td>
                      <td className="py-2 text-center text-muted-foreground">{formatTime(a.avg_response_time)}</td>
                      <td className="py-2 text-center text-muted-foreground">{formatTime(a.avg_duration)}</td>
                      <td className="py-2 text-center">
                        {satData ? (
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-foreground font-medium">{satData.avg_rating}</span>
                            <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                            <span className="text-muted-foreground">({satData.total_ratings})</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
