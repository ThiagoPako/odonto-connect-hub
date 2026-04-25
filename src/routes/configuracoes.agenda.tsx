import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, ArrowLeft, Clock, Stethoscope, Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  clinicaApi,
  dentistasApi,
  type ClinicaConfig,
  type HorariosSemana,
  type DiaSemana,
} from "@/lib/vpsApi";

export const Route = createFileRoute("/configuracoes/agenda")({
  ssr: false,
  component: ConfiguracoesAgendaPage,
});

const DIAS: { key: DiaSemana; label: string }[] = [
  { key: "dom", label: "Domingo" },
  { key: "seg", label: "Segunda" },
  { key: "ter", label: "Terça" },
  { key: "qua", label: "Quarta" },
  { key: "qui", label: "Quinta" },
  { key: "sex", label: "Sexta" },
  { key: "sab", label: "Sábado" },
];

const INTERVALOS = [5, 15, 20, 30, 60];

const DEFAULT_HORARIOS: HorariosSemana = {
  dom: { ativo: false, inicio: "09:00", fim: "18:00" },
  seg: { ativo: true, inicio: "09:00", fim: "18:00" },
  ter: { ativo: true, inicio: "09:00", fim: "18:00" },
  qua: { ativo: true, inicio: "09:00", fim: "18:00" },
  qui: { ativo: true, inicio: "09:00", fim: "18:00" },
  sex: { ativo: true, inicio: "09:00", fim: "18:00" },
  sab: { ativo: false, inicio: "09:00", fim: "13:00" },
};

function HorariosEditor({
  horarios,
  onChange,
  disabled,
}: {
  horarios: HorariosSemana;
  onChange: (h: HorariosSemana) => void;
  disabled?: boolean;
}) {
  const set = (dia: DiaSemana, patch: Partial<HorariosSemana[DiaSemana]>) => {
    onChange({ ...horarios, [dia]: { ...horarios[dia], ...patch } });
  };
  return (
    <div className="space-y-2">
      {DIAS.map(({ key, label }) => {
        const h = horarios[key];
        return (
          <div
            key={key}
            className="grid grid-cols-[120px_60px_1fr_auto_1fr] items-center gap-3 rounded-md border border-border/60 bg-card/50 px-3 py-2"
          >
            <Label className="font-medium">{label}</Label>
            <Switch
              checked={h.ativo}
              onCheckedChange={(v) => set(key, { ativo: v })}
              disabled={disabled}
            />
            <Input
              type="time"
              value={h.inicio}
              onChange={(e) => set(key, { inicio: e.target.value })}
              disabled={disabled || !h.ativo}
              className="h-9"
            />
            <span className="text-sm text-muted-foreground">até</span>
            <Input
              type="time"
              value={h.fim}
              onChange={(e) => set(key, { fim: e.target.value })}
              disabled={disabled || !h.ativo}
              className="h-9"
            />
          </div>
        );
      })}
    </div>
  );
}

function ClinicaTab() {
  const [config, setConfig] = useState<ClinicaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    clinicaApi.getConfig().then(({ data, error }) => {
      if (error) toast.error("Erro ao carregar config: " + error);
      else if (data) setConfig(data);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    const { error } = await clinicaApi.updateConfig({
      horarios: config.horarios,
      intervalo_agenda: config.intervalo_agenda,
      limitar_mesmo_horario: config.limitar_mesmo_horario,
      permitir_horario_indisponivel: config.permitir_horario_indisponivel,
      habilitar_sessoes_procedimento: config.habilitar_sessoes_procedimento,
    });
    setSaving(false);
    if (error) toast.error("Erro ao salvar: " + error);
    else toast.success("Configuração da clínica salva");
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!config) return <p className="text-muted-foreground">Configuração não disponível.</p>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Horários de funcionamento
          </CardTitle>
          <CardDescription>
            Esses horários são usados como padrão para todos os profissionais que não definirem horário próprio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HorariosEditor
            horarios={config.horarios}
            onChange={(h) => setConfig({ ...config, horarios: h })}
            disabled={saving}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regras de agendamento</CardTitle>
          <CardDescription>Como a agenda se comporta ao criar e exibir consultas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-2">
            <Label>Tempo de visualização da agenda (minutos)</Label>
            <div className="flex flex-wrap gap-2">
              {INTERVALOS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={config.intervalo_agenda === m ? "default" : "outline"}
                  onClick={() => setConfig({ ...config, intervalo_agenda: m })}
                  disabled={saving}
                >
                  {m} min
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="font-medium">Limitar agendamentos no mesmo horário</Label>
              <p className="text-sm text-muted-foreground">
                Bloqueia mais de uma consulta no mesmo horário para o mesmo profissional.
              </p>
            </div>
            <Switch
              checked={config.limitar_mesmo_horario}
              onCheckedChange={(v) => setConfig({ ...config, limitar_mesmo_horario: v })}
              disabled={saving}
            />
          </div>

          <Separator />

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="font-medium">Permitir agendar em horários indisponíveis</Label>
              <p className="text-sm text-muted-foreground">
                Permite criar agendamento fora do horário de funcionamento (com aviso).
              </p>
            </div>
            <Switch
              checked={config.permitir_horario_indisponivel}
              onCheckedChange={(v) => setConfig({ ...config, permitir_horario_indisponivel: v })}
              disabled={saving}
            />
          </div>

          <Separator />

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="font-medium">Habilitar sessões de procedimento</Label>
              <p className="text-sm text-muted-foreground">
                Permite encadear múltiplas sessões para um mesmo procedimento.
              </p>
            </div>
            <Switch
              checked={config.habilitar_sessoes_procedimento}
              onCheckedChange={(v) => setConfig({ ...config, habilitar_sessoes_procedimento: v })}
              disabled={saving}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar configuração
        </Button>
      </div>
    </div>
  );
}

interface DentistaItem {
  id: string;
  nome: string;
  especialidade?: string | null;
}

function DentistasTab() {
  const [dentistas, setDentistas] = useState<DentistaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [usarClinica, setUsarClinica] = useState(true);
  const [horarios, setHorarios] = useState<HorariosSemana>(DEFAULT_HORARIOS);
  const [herdado, setHerdado] = useState(true);
  const [loadingHorarios, setLoadingHorarios] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dentistasApi.list().then(({ data, error }) => {
      if (error) toast.error("Erro ao carregar dentistas: " + error);
      else if (Array.isArray(data)) {
        setDentistas(data as DentistaItem[]);
        if (data.length > 0) setSelectedId((data[0] as DentistaItem).id);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingHorarios(true);
    clinicaApi.getDentistaHorarios(selectedId).then(({ data, error }) => {
      if (error) toast.error("Erro ao carregar horários: " + error);
      else if (data) {
        setUsarClinica(!!data.usar_horario_clinica);
        setHorarios(data.horarios || DEFAULT_HORARIOS);
        setHerdado(!!data.herdado);
      }
      setLoadingHorarios(false);
    });
  }, [selectedId]);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    const { error } = await clinicaApi.updateDentistaHorarios(selectedId, {
      usar_horario_clinica: usarClinica,
      horarios: usarClinica ? null : horarios,
    });
    setSaving(false);
    if (error) toast.error("Erro ao salvar: " + error);
    else {
      toast.success("Horários do profissional salvos");
      setHerdado(usarClinica);
    }
  };

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (dentistas.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Nenhum dentista cadastrado. <Link to="/dentistas" className="text-primary underline">Cadastre um dentista</Link> primeiro.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" />
            Horário por profissional
          </CardTitle>
          <CardDescription>
            Por padrão, cada profissional segue o horário da clínica. Desative para definir um horário próprio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-2">
            <Label>Profissional</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder="Selecione um profissional" />
              </SelectTrigger>
              <SelectContent>
                {dentistas.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.nome}
                    {d.especialidade ? ` — ${d.especialidade}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingHorarios ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-muted/30 p-4">
                <div>
                  <Label className="font-medium">Usar horário da clínica</Label>
                  <p className="text-sm text-muted-foreground">
                    Quando ativo, o profissional segue o horário global definido na aba "Clínica".
                  </p>
                </div>
                <Switch
                  checked={usarClinica}
                  onCheckedChange={setUsarClinica}
                  disabled={saving}
                />
              </div>

              {herdado && usarClinica && (
                <Badge variant="secondary" className="gap-1">
                  <Building2 className="h-3 w-3" /> Horário herdado da clínica
                </Badge>
              )}

              <HorariosEditor
                horarios={horarios}
                onChange={setHorarios}
                disabled={saving || usarClinica}
              />

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar horários
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ConfiguracoesAgendaPage() {
  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto max-w-5xl px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Link to="/configuracoes" className="hover:text-foreground inline-flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" /> Configurações
              </Link>
              <span>/</span>
              <span>Agenda</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Configurações da Agenda</h1>
            <p className="text-sm text-muted-foreground">
              Defina os horários de funcionamento da clínica e regras de agendamento.
            </p>
          </div>
        </div>

        <Tabs defaultValue="clinica" className="space-y-4">
          <TabsList>
            <TabsTrigger value="clinica" className="gap-2">
              <Building2 className="h-4 w-4" /> Clínica
            </TabsTrigger>
            <TabsTrigger value="dentistas" className="gap-2">
              <Stethoscope className="h-4 w-4" /> Por profissional
            </TabsTrigger>
          </TabsList>
          <TabsContent value="clinica">
            <ClinicaTab />
          </TabsContent>
          <TabsContent value="dentistas">
            <DentistasTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
