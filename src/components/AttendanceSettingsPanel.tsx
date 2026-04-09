import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Clock, Save, MessageSquareText, PenLine } from "lucide-react";
import { toast } from "sonner";
import { attendanceSettingsApi } from "@/lib/vpsApi";

const STORAGE_KEY = "odonto_attendance_settings";

export interface DaySchedule {
  enabled: boolean;
  openTime: string;
  closeTime: string;
}

export interface AttendanceSettings {
  businessHours: Record<string, DaySchedule>;
  offHoursMessage: string;
  welcomeMessage: string;
  signatureEnabled: boolean;
  signatureTemplate: string; // e.g. "— {name}, Odonto Connect"
  autoGreetingEnabled: boolean;
  quickReplies: QuickReply[];
  closingMessage: string;
  closingMessageEnabled: boolean;
  inactivityTimeout: number; // minutes
  inactivityMessage: string;
  inactivityMessageEnabled: boolean;
}

export interface QuickReply {
  id: string;
  title: string;
  content: string;
  category: string;
}

const DAYS = [
  { key: "mon", label: "Segunda" },
  { key: "tue", label: "Terça" },
  { key: "wed", label: "Quarta" },
  { key: "thu", label: "Quinta" },
  { key: "fri", label: "Sexta" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

const defaultSettings: AttendanceSettings = {
  businessHours: {
    mon: { enabled: true, openTime: "08:00", closeTime: "18:00" },
    tue: { enabled: true, openTime: "08:00", closeTime: "18:00" },
    wed: { enabled: true, openTime: "08:00", closeTime: "18:00" },
    thu: { enabled: true, openTime: "08:00", closeTime: "18:00" },
    fri: { enabled: true, openTime: "08:00", closeTime: "18:00" },
    sat: { enabled: true, openTime: "08:00", closeTime: "12:00" },
    sun: { enabled: false, openTime: "08:00", closeTime: "12:00" },
  },
  offHoursMessage:
    "Olá! 👋 Nosso horário de atendimento é de segunda a sexta, das 8h às 18h, e sábados das 8h às 12h.\n\nDeixe sua mensagem que retornaremos assim que possível! 😊",
  welcomeMessage:
    "Olá! 👋 Seja bem-vindo(a) à *Odonto Connect*! Como podemos ajudá-lo(a) hoje?",
  signatureEnabled: true,
  signatureTemplate: "{name}:",
  autoGreetingEnabled: true,
  quickReplies: [
    { id: "qr1", title: "Agendamento", content: "Claro! Para agendar uma consulta, preciso de algumas informações:\n\n1️⃣ Nome completo\n2️⃣ Telefone\n3️⃣ Procedimento desejado\n4️⃣ Preferência de horário", category: "Agendamento" },
    { id: "qr2", title: "Valores", content: "Os valores variam de acordo com o procedimento. Posso agendar uma *avaliação gratuita* para que o dentista possa elaborar um orçamento personalizado! 😊", category: "Financeiro" },
    { id: "qr3", title: "Convênios", content: "Trabalhamos com os seguintes convênios:\n✅ Amil Dental\n✅ Bradesco Saúde\n✅ SulAmérica\n✅ Porto Seguro\n\nQual é o seu?", category: "Convênio" },
    { id: "qr4", title: "Localização", content: "📍 Estamos localizados na Av. Paulista, 1000 - Bela Vista, São Paulo.\n\n🕐 Seg-Sex: 8h às 18h\n🕐 Sáb: 8h às 12h", category: "Geral" },
    { id: "qr5", title: "Emergência", content: "Entendo que é urgente! 🚨\n\nPor favor, informe:\n1️⃣ O que está sentindo?\n2️⃣ Há quanto tempo?\n3️⃣ Está com dor intensa?\n\nVamos encontrar o melhor horário para atendê-lo(a) o mais rápido possível.", category: "Emergência" },
  ],
  closingMessage: "Obrigado pelo contato! Se precisar de algo mais, estamos à disposição. 😊\n\n⭐ Avalie nosso atendimento!",
  closingMessageEnabled: true,
  inactivityTimeout: 30,
  inactivityMessage: "Olá! Notamos que você ficou um tempo sem responder. Posso ajudar em algo mais? Caso contrário, vou encerrar este atendimento. 😊",
  inactivityMessageEnabled: false,
};

export function getAttendanceSettings(): AttendanceSettings {
  if (typeof window === "undefined") return defaultSettings;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return { ...defaultSettings, ...JSON.parse(stored) };
    } catch {
      return defaultSettings;
    }
  }
  return defaultSettings;
}

export function saveAttendanceSettings(settings: AttendanceSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function isWithinBusinessHours(settings?: AttendanceSettings): boolean {
  const s = settings || getAttendanceSettings();
  const now = new Date();
  const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const dayKey = dayKeys[now.getDay()];
  const schedule = s.businessHours[dayKey];
  if (!schedule?.enabled) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = schedule.openTime.split(":").map(Number);
  const [closeH, closeM] = schedule.closeTime.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
}

export function formatSignature(template: string, userName: string): string {
  return template.replace("{name}", userName);
}

// ─── Settings Panel Component ───

export function AttendanceSettingsPanel() {
  const [settings, setSettings] = useState<AttendanceSettings>(defaultSettings);
  const [activeSection, setActiveSection] = useState<"hours" | "messages" | "quick" | "automation">("hours");

  useEffect(() => {
    setSettings(getAttendanceSettings());
  }, []);

  const handleSave = () => {
    saveAttendanceSettings(settings);
    // Sync to VPS so webhook can use settings
    attendanceSettingsApi.update(settings).then(({ error }) => {
      if (error) console.error("Erro ao sincronizar settings com VPS:", error);
    });
    toast.success("Configurações de atendimento salvas!");
  };

  const updateDay = (dayKey: string, field: keyof DaySchedule, value: string | boolean) => {
    setSettings((prev) => ({
      ...prev,
      businessHours: {
        ...prev.businessHours,
        [dayKey]: { ...prev.businessHours[dayKey], [field]: value },
      },
    }));
  };

  const addQuickReply = () => {
    setSettings((prev) => ({
      ...prev,
      quickReplies: [
        ...prev.quickReplies,
        { id: `qr-${Date.now()}`, title: "", content: "", category: "Geral" },
      ],
    }));
  };

  const updateQuickReply = (id: string, field: keyof QuickReply, value: string) => {
    setSettings((prev) => ({
      ...prev,
      quickReplies: prev.quickReplies.map((qr) => (qr.id === id ? { ...qr, [field]: value } : qr)),
    }));
  };

  const removeQuickReply = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      quickReplies: prev.quickReplies.filter((qr) => qr.id !== id),
    }));
  };

  const sections = [
    { key: "hours" as const, label: "Horários", icon: Clock },
    { key: "messages" as const, label: "Mensagens", icon: MessageSquareText },
    { key: "quick" as const, label: "Respostas Rápidas", icon: PenLine },
    { key: "automation" as const, label: "Automações", icon: Clock },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Clock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Configurações de Atendimento</CardTitle>
            <p className="text-sm text-muted-foreground">
              Horário de expediente, mensagens automáticas e respostas rápidas
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Section Tabs */}
        <div className="flex gap-1 mb-5 border-b border-border">
          {sections.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeSection === s.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          ))}
        </div>

        {/* ─── Business Hours ─── */}
        {activeSection === "hours" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-2">
              Defina o horário de funcionamento da clínica. Fora deste horário, a mensagem automática será enviada.
            </p>
            {DAYS.map((day) => {
              const schedule = settings.businessHours[day.key];
              return (
                <div key={day.key} className="flex items-center gap-3">
                  <Switch
                    checked={schedule?.enabled ?? false}
                    onCheckedChange={(v) => updateDay(day.key, "enabled", v)}
                  />
                  <span className={`w-20 text-sm font-medium ${schedule?.enabled ? "text-foreground" : "text-muted-foreground"}`}>
                    {day.label}
                  </span>
                  {schedule?.enabled ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={schedule.openTime}
                        onChange={(e) => updateDay(day.key, "openTime", e.target.value)}
                        className="w-28 h-8 text-sm"
                      />
                      <span className="text-muted-foreground text-sm">às</span>
                      <Input
                        type="time"
                        value={schedule.closeTime}
                        onChange={(e) => updateDay(day.key, "closeTime", e.target.value)}
                        className="w-28 h-8 text-sm"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Fechado</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ─── Messages ─── */}
        {activeSection === "messages" && (
          <div className="space-y-5">
            {/* Off-hours message */}
            <div>
              <Label className="font-medium">Mensagem fora do horário</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Enviada automaticamente quando o cliente manda mensagem fora do expediente
              </p>
              <Textarea
                value={settings.offHoursMessage}
                onChange={(e) => setSettings((p) => ({ ...p, offHoursMessage: e.target.value }))}
                rows={4}
                maxLength={1000}
                placeholder="Mensagem para fora do horário..."
              />
              <p className="text-[11px] text-muted-foreground mt-1 text-right">{settings.offHoursMessage.length}/1000</p>
            </div>

            <Separator />

            {/* Welcome message */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="font-medium">Mensagem de boas-vindas</Label>
                <Switch
                  checked={settings.autoGreetingEnabled}
                  onCheckedChange={(v) => setSettings((p) => ({ ...p, autoGreetingEnabled: v }))}
                />
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Enviada ao primeiro contato do cliente (antes do menu de filas)
              </p>
              <Textarea
                value={settings.welcomeMessage}
                onChange={(e) => setSettings((p) => ({ ...p, welcomeMessage: e.target.value }))}
                rows={3}
                maxLength={500}
                disabled={!settings.autoGreetingEnabled}
              />
            </div>

            <Separator />

            {/* Closing message */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="font-medium">Mensagem de encerramento</Label>
                <Switch
                  checked={settings.closingMessageEnabled}
                  onCheckedChange={(v) => setSettings((p) => ({ ...p, closingMessageEnabled: v }))}
                />
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Enviada ao finalizar um atendimento
              </p>
              <Textarea
                value={settings.closingMessage}
                onChange={(e) => setSettings((p) => ({ ...p, closingMessage: e.target.value }))}
                rows={3}
                maxLength={500}
                disabled={!settings.closingMessageEnabled}
              />
            </div>

            <Separator />

            {/* Signature */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="font-medium">Assinatura do atendente</Label>
                <Switch
                  checked={settings.signatureEnabled}
                  onCheckedChange={(v) => setSettings((p) => ({ ...p, signatureEnabled: v }))}
                />
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Adicionada ao final de cada mensagem. Use <code className="bg-muted px-1 rounded text-[11px]">{"{name}"}</code> para inserir o nome do atendente
              </p>
              <Input
                value={settings.signatureTemplate}
                onChange={(e) => setSettings((p) => ({ ...p, signatureTemplate: e.target.value }))}
                maxLength={100}
                disabled={!settings.signatureEnabled}
                placeholder="— {name} | Odonto Connect"
              />
              {settings.signatureEnabled && (
                <div className="mt-2 rounded-lg border bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Prévia:</p>
                  <p className="text-sm italic text-foreground">
                    {formatSignature(settings.signatureTemplate, "Dr. Ricardo")}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Quick Replies ─── */}
        {activeSection === "quick" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Respostas Rápidas</p>
                <p className="text-xs text-muted-foreground">
                  Mensagens pré-configuradas acessíveis pelo atalho "/" no chat
                </p>
              </div>
              <Button size="sm" onClick={addQuickReply}>+ Adicionar</Button>
            </div>

            {settings.quickReplies.map((qr) => (
              <div key={qr.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={qr.title}
                    onChange={(e) => updateQuickReply(qr.id, "title", e.target.value)}
                    placeholder="Título (ex: Agendamento)"
                    className="flex-1 h-8 text-sm"
                    maxLength={50}
                  />
                  <Input
                    value={qr.category}
                    onChange={(e) => updateQuickReply(qr.id, "category", e.target.value)}
                    placeholder="Categoria"
                    className="w-32 h-8 text-sm"
                    maxLength={30}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={() => removeQuickReply(qr.id)}
                  >
                    ✕
                  </Button>
                </div>
                <Textarea
                  value={qr.content}
                  onChange={(e) => updateQuickReply(qr.id, "content", e.target.value)}
                  placeholder="Conteúdo da resposta..."
                  rows={2}
                  className="text-sm"
                  maxLength={2000}
                />
              </div>
            ))}
          </div>
        )}

        {/* ─── Automation ─── */}
        {activeSection === "automation" && (
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="font-medium">Mensagem de inatividade</Label>
                <Switch
                  checked={settings.inactivityMessageEnabled}
                  onCheckedChange={(v) => setSettings((p) => ({ ...p, inactivityMessageEnabled: v }))}
                />
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Enviada quando o cliente não responde após o tempo definido
              </p>
              <div className="flex items-center gap-2 mb-2">
                <Label className="text-xs whitespace-nowrap">Tempo (minutos):</Label>
                <Input
                  type="number"
                  value={settings.inactivityTimeout}
                  onChange={(e) => setSettings((p) => ({ ...p, inactivityTimeout: Math.max(5, parseInt(e.target.value) || 30) }))}
                  className="w-24 h-8 text-sm"
                  min={5}
                  max={1440}
                  disabled={!settings.inactivityMessageEnabled}
                />
              </div>
              <Textarea
                value={settings.inactivityMessage}
                onChange={(e) => setSettings((p) => ({ ...p, inactivityMessage: e.target.value }))}
                rows={3}
                maxLength={500}
                disabled={!settings.inactivityMessageEnabled}
              />
            </div>
          </div>
        )}

        <Separator className="my-5" />

        <Button onClick={handleSave} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          Salvar Configurações de Atendimento
        </Button>
      </CardContent>
    </Card>
  );
}
