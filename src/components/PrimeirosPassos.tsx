import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, ChevronRight, Loader2, AlertCircle, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { vpsApiFetch } from "@/lib/vpsApi";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { useAuth } from "@/hooks/useAuth";

interface OnboardingStatus {
  dentistas: number;
  pacientes: number;
  agendamentos: number;
  horarios_configurados: boolean;
  whatsapp_instancias: number;
}

const onboardingApi = () => vpsApiFetch<OnboardingStatus>("/onboarding/status", { background: true });

interface Passo {
  id: string;
  titulo: string;
  ajuda: string;
  to: string;
  acao: string;
  feito: boolean;
}

/**
 * Checklist de primeiros passos da clínica nova (dashboard). O progresso vem do servidor
 * (contagens da própria clínica) e do estado ao vivo do WhatsApp. Some quando tudo estiver feito.
 */
export function PrimeirosPassos() {
  const { user } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { connected, loading: waLoading } = useWhatsAppInstances();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await onboardingApi();
    setStatus(data);
    setError(err);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // O checklist é de quem configura a clínica.
  const isAdmin = user?.role === "admin" || !!user?.is_super_admin;
  if (!isAdmin) return null;

  if (loading && !status) {
    return (
      <section aria-busy="true" className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando os primeiros passos da clínica...
      </section>
    );
  }

  if (error || !status) {
    return (
      <section role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm flex flex-wrap items-center gap-3">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
        <span className="flex-1 min-w-0 text-foreground">
          Não foi possível ver o progresso da configuração da clínica. {error}
        </span>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </section>
    );
  }

  const passos: Passo[] = [
    {
      id: "dentista",
      titulo: "Cadastrar um dentista",
      ajuda: "Sem dentista não há agenda nem consulta.",
      to: "/dentistas",
      acao: "Cadastrar dentista",
      feito: status.dentistas > 0,
    },
    {
      id: "horarios",
      titulo: "Configurar os horários da clínica",
      ajuda: "Dias e horas de atendimento, usados pela agenda.",
      to: "/configuracoes/agenda",
      acao: "Configurar horários",
      feito: status.horarios_configurados,
    },
    {
      id: "whatsapp",
      titulo: "Conectar o WhatsApp da clínica",
      ajuda: "Leia o QR Code com o celular do número da clínica.",
      to: "/canais",
      acao: "Conectar WhatsApp",
      feito: connected.length > 0,
    },
    {
      id: "paciente",
      titulo: "Cadastrar o primeiro paciente",
      ajuda: "Nome e telefone já bastam para começar.",
      to: "/pacientes",
      acao: "Cadastrar paciente",
      feito: status.pacientes > 0,
    },
    {
      id: "agendamento",
      titulo: "Criar o primeiro agendamento",
      ajuda: "Escolha o dentista, o paciente e o horário.",
      to: "/agenda",
      acao: "Abrir agenda",
      feito: status.agendamentos > 0,
    },
  ];

  const feitos = passos.filter((p) => p.feito).length;
  if (feitos === passos.length) return null;
  const proximo = passos.find((p) => !p.feito);
  const pct = Math.round((feitos / passos.length) * 100);

  return (
    <section aria-labelledby="primeiros-passos-titulo" className="rounded-2xl border border-primary/30 bg-card p-4 sm:p-5 shadow-card">
      <div className="flex flex-wrap items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center" aria-hidden="true">
          <Rocket className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <h2 id="primeiros-passos-titulo" className="text-base font-semibold text-foreground">
            Primeiros passos da clínica
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {feitos} de {passos.length} concluídos. Faça na ordem: cada passo prepara o seguinte.
          </p>
        </div>
        {proximo && (
          <Button asChild size="sm" className="w-full sm:w-auto">
            <Link to={proximo.to}>
              {proximo.acao} <ChevronRight className="h-4 w-4 ml-1" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>

      <Progress value={pct} className="mt-4 h-2" aria-label={`Progresso: ${feitos} de ${passos.length}`} />

      <ol className="mt-4 divide-y divide-border">
        {passos.map((p) => {
          const icone = p.feito ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          ) : p.id === "whatsapp" && waLoading ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <Circle className="h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          );
          const texto = (
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${p.feito ? "text-muted-foreground line-through" : "text-foreground"}`}>
                {p.titulo}
                <span className="sr-only">{p.feito ? " (concluído)" : " (pendente)"}</span>
              </p>
              {!p.feito && <p className="text-xs text-muted-foreground">{p.ajuda}</p>}
            </div>
          );
          return (
            <li key={p.id}>
              {p.feito ? (
                <div className="flex items-center gap-3 py-2.5">{icone}{texto}</div>
              ) : (
                // A linha inteira é o link: alvo grande no celular, sem texto espremido.
                <Link
                  to={p.to}
                  className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {icone}
                  {texto}
                  <span className="hidden sm:inline text-xs font-medium text-primary">{p.acao}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
