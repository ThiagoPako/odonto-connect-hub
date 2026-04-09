import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Headset,
  MessageSquare,
  CalendarCheck,
  TrendingUp,
  Users,
  Clock,
  Search,
  Phone,
  MapPin,
  Instagram,
  Globe,
  UserPlus,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Star,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/painel-comercial")({
  ssr: false,
  component: PainelComercialPage,
});

/* ── Mock Data ────────────────────────────────────────── */

interface Lead {
  id: string;
  name: string;
  phone: string;
  origin: string;
  originIcon: typeof Instagram;
  status: "novo" | "em_atendimento" | "agendado" | "perdido";
  lastMessage: string;
  lastMessageTime: string;
  assignedTo: string;
}

interface FollowUp {
  id: string;
  leadName: string;
  type: "retorno" | "confirmacao" | "reativacao";
  scheduledAt: string;
  note: string;
}

const mockLeads: Lead[] = [
  { id: "1", name: "Maria Oliveira", phone: "(11) 99123-4567", origin: "Instagram", originIcon: Instagram, status: "novo", lastMessage: "Olá, gostaria de saber sobre clareamento", lastMessageTime: "há 5 min", assignedTo: "comercial1" },
  { id: "2", name: "João Santos", phone: "(11) 98765-4321", origin: "Google Ads", originIcon: Globe, status: "em_atendimento", lastMessage: "Qual o valor da consulta?", lastMessageTime: "há 12 min", assignedTo: "comercial1" },
  { id: "3", name: "Ana Costa", phone: "(11) 97654-3210", origin: "Indicação", originIcon: UserPlus, status: "agendado", lastMessage: "Perfeito, confirmo dia 15/04 às 14h", lastMessageTime: "há 1h", assignedTo: "comercial1" },
  { id: "4", name: "Carlos Ferreira", phone: "(11) 96543-2109", origin: "Site", originIcon: Globe, status: "em_atendimento", lastMessage: "Vocês fazem implante?", lastMessageTime: "há 25 min", assignedTo: "comercial1" },
  { id: "5", name: "Patrícia Lima", phone: "(11) 95432-1098", origin: "Instagram", originIcon: Instagram, status: "novo", lastMessage: "Vi o post sobre lentes de contato", lastMessageTime: "há 2h", assignedTo: "comercial1" },
  { id: "6", name: "Roberto Alves", phone: "(11) 94321-0987", origin: "Google Ads", originIcon: Globe, status: "perdido", lastMessage: "Vou pensar e volto a falar", lastMessageTime: "há 3 dias", assignedTo: "comercial1" },
];

const mockFollowUps: FollowUp[] = [
  { id: "1", leadName: "João Santos", type: "retorno", scheduledAt: "Hoje, 14:00", note: "Enviar tabela de preços" },
  { id: "2", leadName: "Carlos Ferreira", type: "retorno", scheduledAt: "Hoje, 16:30", note: "Explicar opções de implante" },
  { id: "3", leadName: "Patrícia Lima", type: "confirmacao", scheduledAt: "Amanhã, 09:00", note: "Confirmar interesse nas lentes" },
  { id: "4", leadName: "Roberto Alves", type: "reativacao", scheduledAt: "Amanhã, 11:00", note: "Reativar com promoção de implante" },
];

const kpis = {
  atendimentosHoje: 18,
  agendamentosHoje: 6,
  taxaConversao: 33,
  leadsPendentes: 4,
};

/* ── Helpers ──────────────────────────────────────────── */

const statusConfig: Record<string, { label: string; class: string }> = {
  novo: { label: "Novo", class: "bg-chart-4/15 text-chart-4 border-chart-4/30" },
  em_atendimento: { label: "Em atendimento", class: "bg-primary/15 text-primary border-primary/30" },
  agendado: { label: "Agendado", class: "bg-chart-2/15 text-chart-2 border-chart-2/30" },
  perdido: { label: "Perdido", class: "bg-destructive/15 text-destructive border-destructive/30" },
};

const followUpTypeConfig: Record<string, { label: string; class: string }> = {
  retorno: { label: "Retorno", class: "bg-primary/15 text-primary" },
  confirmacao: { label: "Confirmação", class: "bg-chart-2/15 text-chart-2" },
  reativacao: { label: "Reativação", class: "bg-chart-4/15 text-chart-4" },
};

/* ── Component ────────────────────────────────────────── */

function PainelComercialPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");

  const filteredLeads = mockLeads.filter((l) => {
    const matchesSearch =
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.phone.includes(search) ||
      l.origin.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "todos" || l.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Painel Comercial" />
      <main className="flex-1 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-chart-4/15 flex items-center justify-center">
            <Headset className="h-5 w-5 text-chart-4" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              Olá, {user?.name?.split(" ")[0] ?? "Comercial"} 👋
            </h2>
            <p className="text-sm text-muted-foreground">
              Gerencie seus atendimentos e converta leads em pacientes
            </p>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiMini
            icon={MessageSquare}
            label="Atendimentos hoje"
            value={kpis.atendimentosHoje}
            color="text-primary"
            bg="bg-primary/10"
          />
          <KpiMini
            icon={CalendarCheck}
            label="Agendamentos hoje"
            value={kpis.agendamentosHoje}
            color="text-chart-2"
            bg="bg-chart-2/10"
          />
          <KpiMini
            icon={TrendingUp}
            label="Taxa de conversão"
            value={`${kpis.taxaConversao}%`}
            color="text-chart-4"
            bg="bg-chart-4/10"
          />
          <KpiMini
            icon={AlertCircle}
            label="Leads pendentes"
            value={kpis.leadsPendentes}
            color="text-destructive"
            bg="bg-destructive/10"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Leads List — 2 columns */}
          <div className="xl:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    Meus Leads
                  </CardTitle>
                  <Link to="/chat">
                    <Button size="sm" variant="outline">
                      <MessageSquare className="h-4 w-4 mr-1" /> Abrir Chat
                    </Button>
                  </Link>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar lead, telefone ou origem..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="flex gap-1">
                    {["todos", "novo", "em_atendimento", "agendado", "perdido"].map((s) => (
                      <Button
                        key={s}
                        variant={statusFilter === s ? "default" : "outline"}
                        size="sm"
                        className="text-xs"
                        onClick={() => setStatusFilter(s)}
                      >
                        {s === "todos" ? "Todos" : statusConfig[s]?.label ?? s}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {filteredLeads.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Nenhum lead encontrado
                  </p>
                ) : (
                  <div className="divide-y rounded-xl border overflow-hidden">
                    {filteredLeads.map((lead) => (
                      <LeadRow key={lead.id} lead={lead} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Follow-ups — 1 column */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-chart-4" />
                  Follow-ups do dia
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {mockFollowUps.map((fu) => (
                  <div
                    key={fu.id}
                    className="p-3 rounded-xl border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{fu.leadName}</span>
                      <Badge variant="outline" className={`text-[10px] ${followUpTypeConfig[fu.type]?.class ?? ""}`}>
                        {followUpTypeConfig[fu.type]?.label ?? fu.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{fu.note}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {fu.scheduledAt}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Origin distribution */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  Origem dos Leads
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <OriginBar label="Instagram" icon={Instagram} count={8} total={20} color="bg-chart-4" />
                <OriginBar label="Google Ads" icon={Globe} count={6} total={20} color="bg-primary" />
                <OriginBar label="Indicação" icon={UserPlus} count={4} total={20} color="bg-chart-2" />
                <OriginBar label="Site" icon={Globe} count={2} total={20} color="bg-chart-3" />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────── */

function KpiMini({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
  color: string;
  bg: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LeadRow({ lead }: { lead: Lead }) {
  const OriginIcon = lead.originIcon;
  const cfg = statusConfig[lead.status];

  return (
    <div className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
        {lead.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium truncate">{lead.name}</span>
          <Badge variant="outline" className={`text-[10px] shrink-0 ${cfg.class}`}>
            {cfg.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{lead.lastMessage}</p>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Phone className="h-3 w-3" /> {lead.phone}
          </span>
          <span className="flex items-center gap-1">
            <OriginIcon className="h-3 w-3" /> {lead.origin}
          </span>
          <span>{lead.lastMessageTime}</span>
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        <Link to="/chat">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Abrir conversa">
            <MessageSquare className="h-4 w-4" />
          </Button>
        </Link>
        {lead.status !== "agendado" && (
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Agendar">
            <CalendarCheck className="h-4 w-4 text-chart-2" />
          </Button>
        )}
        {lead.status === "agendado" && (
          <CheckCircle2 className="h-5 w-5 text-chart-2 self-center" />
        )}
      </div>
    </div>
  );
}

function OriginBar({
  label,
  icon: Icon,
  count,
  total,
  color,
}: {
  label: string;
  icon: typeof Instagram;
  count: number;
  total: number;
  color: string;
}) {
  const pct = Math.round((count / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" /> {label}
        </span>
        <span className="font-medium">{count} <span className="text-muted-foreground text-xs">({pct}%)</span></span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
