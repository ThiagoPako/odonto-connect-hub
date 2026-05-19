import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ExternalLink, Webhook, KeyRound, Building2, CheckCircle2 } from "lucide-react";

const STEPS = [
  {
    icon: Building2,
    title: "1. Acesso Externo na Clinicorp",
    body: 'No painel da Clinicorp, abra "Acesso Externo e Integrações". Você verá o campo "Usuário API" (ex: sorrisominacu). Copie esse valor.',
  },
  {
    icon: KeyRound,
    title: "2. Gere o Token API",
    body: 'Na mesma tela, clique no ícone de cópia ao lado do "Token API". Cole esse token e o Usuário API nos campos correspondentes aqui no Odonto Connect.',
  },
  {
    icon: Webhook,
    title: "3. Cadastre o Webhook",
    body: 'Em "Gestão Webhook" da Clinicorp, selecione o modelo "Agenda Pessoal" (e qualquer outro que queira receber em tempo real). No campo Endpoint, cole a URL gerada abaixo e clique OK.',
  },
  {
    icon: CheckCircle2,
    title: "4. Verifique o Status",
    body: 'Volte para "Gerenciar Contas" da Clinicorp e confirme que o status do acesso está LIBERADO. Depois clique em "Testar conexão" aqui no Odonto Connect para validar.',
  },
] as const;

const EVENTS = [
  "agendamento_criado",
  "agendamento_alterado",
  "agendamento_cancelado",
  "paciente_criado",
  "paciente_alterado",
  "orcamento_criado",
  "orcamento_aprovado",
];

export function ClinicorpIntegrationGuide() {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          Como conectar à Clinicorp
        </CardTitle>
        <CardDescription>
          Siga o mesmo fluxo do painel oficial da Clinicorp — leva menos de 2 minutos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3">
          {STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="flex gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium leading-tight">{s.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.body}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <p className="text-xs font-medium mb-2">Eventos recebidos automaticamente via webhook:</p>
          <div className="flex flex-wrap gap-1.5">
            {EVENTS.map((e) => (
              <Badge key={e} variant="secondary" className="text-[10px] font-mono">
                {e}
              </Badge>
            ))}
          </div>
        </div>

        <a
          href="https://app.clinicorp.com/security/external_access"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          Abrir painel da Clinicorp <ExternalLink className="h-3 w-3" />
        </a>
      </CardContent>
    </Card>
  );
}
