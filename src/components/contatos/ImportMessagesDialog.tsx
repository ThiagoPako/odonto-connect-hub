import { useState, useEffect, useCallback, useRef } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  MessageSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  Smartphone,
  CalendarIcon,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { whatsappApi, getAccessToken, VPS_API_BASE } from "@/lib/vpsApi";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { fetchInstances as fetchEvolutionInstances, fetchWhatsAppContacts, fetchWhatsAppMessages } from "@/lib/evolutionApi";
import { supabase } from "@/integrations/supabase/client";

interface InstanceResult {
  name: string;
  imported: number;
  skipped: number;
  contacts: number;
  error: string | null;
}

interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  instances: InstanceResult[];
  message?: string;
  error?: string;
}

interface WaInstance {
  name: string;
  status: string;
  profilePictureUrl?: string;
}

type ParsedMessage = {
  content: string;
  type: string;
  file_name?: string;
  mime_type?: string;
};

const getMessageTimestamp = (msg: any): Date | null => {
  const raw =
    msg?.messageTimestamp ??
    msg?.message?.messageTimestamp ??
    msg?.timestamp ??
    msg?.createdAt ??
    msg?.messageTimestampMs ??
    msg?.key?.timestamp;
  if (!raw) return null;
  let ms: number;
  if (typeof raw === "number") {
    ms = raw > 1e12 ? raw : raw * 1000;
  } else if (typeof raw === "string") {
    // Could be ISO date or numeric string (seconds)
    const asNum = Number(raw);
    if (!Number.isNaN(asNum) && asNum > 0 && /^\d+$/.test(raw)) {
      ms = asNum > 1e12 ? asNum : asNum * 1000;
    } else {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return null;
      return d;
    }
  } else {
    return null;
  }
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseMessageContent = (msg: any): ParsedMessage | null => {
  const m = msg?.message || {};
  if (m.conversation) return { content: m.conversation, type: "text" };
  if (m.extendedTextMessage?.text) return { content: m.extendedTextMessage.text, type: "text" };
  if (m.imageMessage) return { content: m.imageMessage.caption || "📷 Imagem", type: "image", mime_type: m.imageMessage.mimetype };
  if (m.videoMessage) return { content: m.videoMessage.caption || "🎥 Vídeo", type: "video", mime_type: m.videoMessage.mimetype };
  if (m.audioMessage) return { content: "🎵 Áudio", type: "audio", mime_type: m.audioMessage.mimetype };
  if (m.documentMessage) return { content: m.documentMessage.fileName || "📄 Documento", type: "document", file_name: m.documentMessage.fileName, mime_type: m.documentMessage.mimetype };
  if (m.stickerMessage) return { content: "🏷️ Sticker", type: "sticker" };
  if (m.contactMessage) return { content: `👤 ${m.contactMessage.displayName || "Contato"}`, type: "contact" };
  if (m.locationMessage) return { content: "📍 Localização", type: "location" };
  if (m.protocolMessage || m.senderKeyDistributionMessage || msg?.messageStubType) return null;
  // Fallback: if message text is at top level (some Evolution v2 records)
  if (typeof msg?.text === "string" && msg.text) return { content: msg.text, type: "text" };
  if (typeof msg?.content === "string" && msg.content) return { content: msg.content, type: "text" };
  return { content: "[Mensagem não suportada]", type: "text" };
};

interface ImportMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

const PERIOD_PRESETS = [
  { label: "Últimos 7 dias", days: 7 },
  { label: "Últimos 15 dias", days: 15 },
  { label: "Últimos 30 dias", days: 30 },
  { label: "Últimos 90 dias", days: 90 },
];

export function ImportMessagesDialog({
  open,
  onOpenChange,
  onImported,
}: ImportMessagesDialogProps) {
  const [startDate, setStartDate] = useState<Date>(subDays(new Date(), 7));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Progress state
  const [progress, setProgress] = useState<{
    message: string;
    contactName?: string;
    contactIndex?: number;
    totalContacts?: number;
    instanceName?: string;
    instanceIndex?: number;
    totalInstances?: number;
    imported?: number;
    skipped?: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Instance selection — uses the same source as Canais page (Evolution API direct)
  // with fallback to VPS backend, so what appears in Canais also appears here.
  const { instances: hookInstances, refresh: refreshHookInstances } = useWhatsAppInstances({ active: open });
  const [instances, setInstances] = useState<WaInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [selectedInstances, setSelectedInstances] = useState<Set<string>>(new Set());

  const hasLoadedRef = useRef(false);

  const loadInstances = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadingInstances(true);
    let list: WaInstance[] = [];

    // 1) Try Evolution API directly (same as Canais)
    try {
      const evo = await fetchEvolutionInstances();
      list = evo.map((i) => ({ name: i.instanceName, status: i.status }));
    } catch (e) {
      console.warn("[ImportMessages] Evolution fetch failed, trying VPS backend", e);
    }

    // 2) Fallback to VPS backend
    if (list.length === 0) {
      const { data } = await whatsappApi.instances();
      if (Array.isArray(data)) {
        list = data.map((i: any) => ({
          name: i.name || i.instanceName || i.instance?.instanceName,
          status: i.connectionStatus || i.status || "unknown",
        }));
      }
    }

    // 3) Last resort — use shared hook cache
    if (list.length === 0 && hookInstances.length > 0) {
      list = hookInstances.map((i) => ({ name: i.instanceName, status: i.connectionState }));
    }

    // Only update state if list actually changed (prevents flicker from polling)
    setInstances((prev) => {
      if (
        prev.length === list.length &&
        prev.every((p, i) => p.name === list[i].name && p.status === list[i].status)
      ) {
        return prev;
      }
      return list;
    });

    // Only auto-select connected instances on first load
    if (!hasLoadedRef.current) {
      setSelectedInstances(new Set(list.filter((i) => i.status === "open").map((i) => i.name)));
      hasLoadedRef.current = true;
    }
    if (showLoading) setLoadingInstances(false);
  }, [hookInstances]);

  useEffect(() => {
    if (open) {
      hasLoadedRef.current = false;
      void refreshHookInstances();
      void loadInstances(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Silent refresh when shared hook cache updates (no flicker)
  useEffect(() => {
    if (open && hasLoadedRef.current) {
      void loadInstances(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookInstances]);

  const toggleInstance = (name: string) => {
    setSelectedInstances(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const applyPreset = (days: number) => {
    setStartDate(subDays(new Date(), days));
    setEndDate(new Date());
  };

  const runDirectImport = async (): Promise<ImportResult> => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sessão expirada. Faça login novamente.");

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError || !profile?.tenant_id) throw new Error("Não foi possível identificar a clínica da sessão atual.");

    const tenantId = profile.tenant_id;
    const selected = Array.from(selectedInstances);
    const instanceResults: InstanceResult[] = [];
    let totalImported = 0;
    let totalSkipped = 0;

    for (let ii = 0; ii < selected.length; ii++) {
      if (abortRef.current?.signal.aborted) break;
      const instanceName = selected[ii];
      const instResult: InstanceResult = { name: instanceName, imported: 0, skipped: 0, contacts: 0, error: null };
      setProgress({ message: `Buscando contatos de ${instanceName}...`, instanceName, instanceIndex: ii, totalInstances: selected.length });

      try {
        const contacts = await fetchWhatsAppContacts(instanceName);
        const uniqueContacts = Array.from(new Map(contacts.map((c) => [c.id, c])).values());
        instResult.contacts = uniqueContacts.length;

        for (let ci = 0; ci < uniqueContacts.length; ci++) {
          if (abortRef.current?.signal.aborted) break;
          const contact = uniqueContacts[ci];
          const phone = contact.id.replace(/\D/g, "");
          if (!phone) continue;
          const remoteJid = `${phone}@s.whatsapp.net`;
          const contactName = contact.pushName?.trim() || phone;

          setProgress({
            message: `Processando ${contactName}...`,
            contactName,
            contactIndex: ci,
            totalContacts: uniqueContacts.length,
            instanceName,
            instanceIndex: ii,
            totalInstances: selected.length,
            imported: totalImported,
            skipped: totalSkipped,
          });

          const { data: existingContact } = await supabase
            .from("contatos")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("telefone", phone)
            .limit(1);
          if (!existingContact?.length) {
            await supabase.from("contatos").insert({ tenant_id: tenantId, nome: contactName, telefone: phone, tipo: "pessoal" } as never).then(() => undefined);
          }

          const suffix = phone.slice(-11);
          const { data: existingLeads } = await supabase
            .from("crm_leads")
            .select("id,nome,telefone")
            .eq("tenant_id", tenantId)
            .or(`telefone.eq.${phone},telefone.ilike.%${suffix}`)
            .limit(1);

          let leadId = existingLeads?.[0]?.id as string | undefined;
          if (!leadId) {
            const { data: newLead, error: leadError } = await supabase
              .from("crm_leads")
              .insert({ tenant_id: tenantId, nome: contactName, telefone: phone, origem: "whatsapp", status: "novo", kanban_stage: "lead", awaiting_queue_selection: true } as never)
              .select("id")
              .single();
            if (leadError) throw leadError;
            leadId = newLead?.id as string | undefined;
          }
          if (!leadId) continue;

          const rawMessages = await fetchWhatsAppMessages(instanceName, remoteJid);
          const rows = rawMessages
            .map((msg) => ({ msg, timestamp: getMessageTimestamp(msg), parsed: parseMessageContent(msg) }))
            .filter((item) => item.timestamp && item.timestamp >= startDate && item.timestamp <= new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999) && item.parsed)
            .map((item) => {
              const msgId = item.msg?.key?.id || item.msg?.id || `evo-${instanceName}-${phone}-${item.timestamp!.getTime()}`;
              return {
                id: msgId,
                tenant_id: tenantId,
                lead_id: leadId,
                content: item.parsed!.content,
                sender: item.msg?.key?.fromMe ? "attendant" : "lead",
                type: item.parsed!.type,
                status: "delivered",
                timestamp: item.timestamp!.toISOString(),
                file_name: item.parsed!.file_name ?? null,
                mime_type: item.parsed!.mime_type ?? null,
                instance: instanceName,
                phone,
                metadata: { importedFrom: "whatsapp", contactName },
              };
            });

          if (rows.length === 0) continue;
          const ids = rows.map((r) => r.id);
          const { data: existingMessages } = await supabase.from("chat_messages").select("id").in("id", ids);
          const existingIds = new Set((existingMessages || []).map((r: any) => r.id));
          const newRows = rows.filter((r) => !existingIds.has(r.id));
          instResult.skipped += rows.length - newRows.length;
          totalSkipped += rows.length - newRows.length;

          if (newRows.length > 0) {
            const { error: insertError } = await supabase.from("chat_messages").insert(newRows as never);
            if (insertError) throw insertError;
            instResult.imported += newRows.length;
            totalImported += newRows.length;
          }
        }
      } catch (error) {
        instResult.error = error instanceof Error ? error.message : "Erro na importação direta";
      }
      instanceResults.push(instResult);
    }

    return { success: true, imported: totalImported, skipped: totalSkipped, instances: instanceResults };
  };

  const handleImport = async () => {
    setLoading(true);
    setResult(null);
    setProgress({ message: "Iniciando importação..." });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Garante sessão Supabase válida antes de importar
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        await supabase.auth.refreshSession();
      }

      // Import direto (cliente -> Evolution API + Supabase).
      // O endpoint VPS /messages/import-whatsapp tem bugs conhecidos
      // (lead_id incorreto como telefone string, tenant_id ausente em
      // chat_messages, e errors silenciados) — usamos o caminho direto
      // que cria leads corretamente e insere mensagens com tenant_id.
      const directResult = await runDirectImport();
      setResult(directResult);
      setProgress(null);
      if (directResult.imported > 0) onImported?.();
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setResult({
          success: false,
          imported: 0,
          skipped: 0,
          instances: [],
          error: err.message || "Erro ao importar mensagens",
        });
        setProgress(null);
      }
    }
    setLoading(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setResult(null);
      setProgress(null);
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    }
    onOpenChange(v);
  };

  const connectedInstances = instances.filter(i => i.status === 'open');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Importar Mensagens do WhatsApp
          </DialogTitle>
          <DialogDescription>
            Importa o histórico de mensagens de todas as instâncias conectadas para o período selecionado.
          </DialogDescription>
        </DialogHeader>

        {!result && !loading && (
          <div className="space-y-4">
            {/* Instance selection */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Instâncias WhatsApp
              </label>
              {loadingInstances ? (
                <div className="flex items-center gap-2 py-3 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Carregando instâncias...</span>
                </div>
              ) : instances.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">Nenhuma instância encontrada</p>
              ) : (
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                  {instances.map((inst) => {
                    const isConnected = inst.status === 'open';
                    return (
                      <label
                        key={inst.name}
                        className={cn(
                          "flex items-center gap-2.5 p-2 rounded-lg border transition-colors cursor-pointer",
                          selectedInstances.has(inst.name)
                            ? "border-primary/40 bg-primary/5"
                            : "border-border hover:bg-muted/40",
                          !isConnected && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <Checkbox
                          checked={selectedInstances.has(inst.name)}
                          onCheckedChange={() => isConnected && toggleInstance(inst.name)}
                          disabled={!isConnected}
                          className="shrink-0"
                        />
                        <Smartphone className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate flex-1">{inst.name}</span>
                        {isConnected ? (
                          <Badge variant="outline" className="text-[10px] bg-chart-2/10 text-chart-2 border-chart-2/30 gap-1">
                            <Wifi className="h-2.5 w-2.5" /> Conectada
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground gap-1">
                            <WifiOff className="h-2.5 w-2.5" /> Offline
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Period presets */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Período rápido
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {PERIOD_PRESETS.map((p) => (
                  <Button
                    key={p.days}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => applyPreset(p.days)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Date range pickers */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Data início
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal h-9 text-sm",
                        !startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                      {startDate ? format(startDate, "dd/MM/yyyy") : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={(d) => d && setStartDate(d)}
                      disabled={(d) => d > new Date()}
                      locale={ptBR}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Data fim
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal h-9 text-sm",
                        !endDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                      {endDate ? format(endDate, "dd/MM/yyyy") : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={(d) => d && setEndDate(d)}
                      disabled={(d) => d > new Date() || d < startDate}
                      locale={ptBR}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                Período: <span className="font-medium text-foreground">
                  {format(startDate, "dd/MM/yyyy")} — {format(endDate, "dd/MM/yyyy")}
                </span>{" "}
                ({Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1} dias)
                {" · "}{selectedInstances.size} instância{selectedInstances.size !== 1 ? "s" : ""} selecionada{selectedInstances.size !== 1 ? "s" : ""}
              </p>
            </div>

            <Button onClick={handleImport} className="w-full" disabled={selectedInstances.size === 0}>
              <MessageSquare className="h-4 w-4 mr-2" />
              {selectedInstances.size === 0 ? "Selecione ao menos uma instância" : "Iniciar Importação"}
            </Button>
          </div>
        )}

        {loading && (
          <div className="space-y-4 py-4">
            {/* Progress bar */}
            {progress && progress.totalContacts != null && progress.contactIndex != null ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Instância: <span className="font-medium text-foreground">{progress.instanceName}</span>
                      {progress.totalInstances && (
                        <span className="text-muted-foreground"> ({(progress.instanceIndex ?? 0) + 1}/{progress.totalInstances})</span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {progress.contactIndex + 1}/{progress.totalContacts}
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${((progress.contactIndex + 1) / progress.totalContacts) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {progress.contactName}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {progress.imported ?? 0} importadas · {progress.skipped ?? 0} duplicadas
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  {progress?.message || "Iniciando importação..."}
                </p>
              </div>
            )}

            <Button variant="outline" size="sm" className="w-full" onClick={() => handleClose(false)}>
              Cancelar
            </Button>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              {result.success && !result.error ? (
                <CheckCircle2 className="h-6 w-6 text-chart-2 shrink-0" />
              ) : (
                <XCircle className="h-6 w-6 text-destructive shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">
                  {result.error
                    ? `Erro: ${result.error}`
                    : result.message
                      ? result.message
                      : `${result.imported} mensagen${result.imported !== 1 ? "s" : ""} importada${result.imported !== 1 ? "s" : ""}`}
                </p>
                {result.skipped > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {result.skipped} mensagen{result.skipped !== 1 ? "s" : ""} já existente{result.skipped !== 1 ? "s" : ""} (ignoradas)
                  </p>
                )}
              </div>
            </div>

            {/* Per-instance details */}
            {result.instances.length > 0 && (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {result.instances.map((inst) => (
                    <div
                      key={inst.name}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Smartphone className="h-4 w-4 text-primary shrink-0" />
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-foreground truncate block">
                            {inst.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {inst.contacts} contato{inst.contacts !== 1 ? "s" : ""} verificado{inst.contacts !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {inst.error ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Erro
                          </Badge>
                        ) : (
                          <>
                            <Badge variant="outline" className="text-[10px] bg-chart-2/10 text-chart-2 border-chart-2/30">
                              +{inst.imported}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {inst.skipped} exist.
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setResult(null)}
              >
                Importar outro período
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleClose(false)}
              >
                Fechar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
