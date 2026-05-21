import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Copy, CheckCircle2, AlertCircle, KeyRound, Webhook, Plug, ListChecks, Shield, Trash2, Plus, ChevronDown, ChevronRight, User, Users, CalendarDays, History, X, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  clinicorpApi,
  buildWebhookUrl,
  generateWebhookSecret,
  type ClinicorpSettings,
  type ClinicorpWebhookEvent,
  type ClinicorpSyncResult,
  type ClinicorpOverride,
  type ClinicorpConflict,
  type ClinicorpOverrideHistory,
} from "@/lib/clinicorpApi";
import { ClinicorpUserCredentials } from "@/components/ClinicorpUserCredentials";
import { ClinicorpIntegrationGuide } from "@/components/ClinicorpIntegrationGuide";
import { ClinicorpAuditLog } from "@/components/clinicorp/ClinicorpAuditLog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ClinicorpPanel() {
  const [settings, setSettings] = useState<ClinicorpSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; auth: string; total_latency_ms: number; results: any[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    step: string;
    summary: Record<string, number>;
    errors: string[];
    startTime: number;
    completed: boolean;
  } | null>(null);
  const [events, setEvents] = useState<ClinicorpWebhookEvent[]>([]);
  const [lastSync, setLastSync] = useState<ClinicorpSyncResult | null>(null);

  // form state
  const [enabled, setEnabled] = useState(false);
  const [subscriberId, setSubscriberId] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.clinicorp.com/rest/v1");
  const [apiToken, setApiToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [intervalMin, setIntervalMin] = useState(30);
  const [lookbackDays, setLookbackDays] = useState(30);
  const [lookaheadDays, setLookaheadDays] = useState(60);
  const [conflictStrategy, setConflictStrategy] = useState<"clinicorp_wins" | "local_wins" | "newest_wins">("newest_wins");
  const [overrides, setOverrides] = useState<ClinicorpOverride[]>([]);
  const [conflicts, setConflicts] = useState<ClinicorpConflict[]>([]);
  const [clinicsList, setClinicsList] = useState<Array<{ id: string; name: string }>>([]);
  const [profsList, setProfsList] = useState<Array<{ id: string; name: string }>>([]);
  const [history, setHistory] = useState<ClinicorpOverrideHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const s = await clinicorpApi.getSettings();
      setSettings(s);
      setEnabled(s.enabled);
      setSubscriberId(s.subscriber_id || "");
      setBaseUrl(s.base_url || "https://api.clinicorp.com/rest/v1");
      setAutoSync(s.auto_sync_enabled ?? true);
      setIntervalMin(s.sync_interval_minutes ?? 30);
      setLookbackDays(s.sync_lookback_days ?? 30);
      setLookaheadDays(s.sync_lookahead_days ?? 60);
      setConflictStrategy(s.conflict_strategy ?? "newest_wins");
      const [evs, ovs, cfs, hist] = await Promise.all([
        clinicorpApi.listWebhookEvents(50),
        clinicorpApi.listOverrides(),
        clinicorpApi.listConflicts({ limit: 50 }),
        clinicorpApi.listOverrideHistory({ limit: 100 }).catch(() => []),
      ]);
      setEvents(evs);
      setOverrides(ovs);
      setConflicts(cfs);
      setHistory(hist);
      
      if (s.enabled) {
        clinicorpApi.listClinics().then((rows) => {
          setClinicsList(rows.map((r) => ({
            id: String((r as any).id ?? (r as any).Id ?? ''),
            name: String((r as any).name ?? (r as any).BusinessName ?? (r as any).Name ?? ''),
          })).filter((c) => c.id));
        }).catch(() => {});
        clinicorpApi.listProfessionals().then((rows) => {
          setProfsList(rows.map((r) => ({
            id: String((r as any).id ?? (r as any).Id ?? (r as any).Dentist_PersonId ?? ''),
            name: String((r as any).full_name ?? (r as any).FullName ?? (r as any).Name ?? ''),
          })).filter((p) => p.id));
        }).catch(() => {});
      }
    } catch (e) {
      toast.error(`Falha: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await clinicorpApi.saveSettings({
        enabled,
        subscriber_id: subscriberId,
        base_url: baseUrl,
        api_token: apiToken || undefined,
        webhook_secret: webhookSecret || undefined,
        auto_sync_enabled: autoSync,
        sync_interval_minutes: intervalMin,
        sync_lookback_days: lookbackDays,
        sync_lookahead_days: lookaheadDays,
        conflict_strategy: conflictStrategy,
      });
      setApiToken("");
      setWebhookSecret("");
      toast.success("Salvo");
      await load();
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setLastSync(null);
    setSyncStatus({ step: "Sincronizando...", summary: {}, errors: [], startTime: Date.now(), completed: false });
    try {
      const r = await clinicorpApi.sync();
      setLastSync(r);
      setSyncStatus(prev => ({ ...prev!, step: "Concluído", summary: r.summary, errors: r.errors, completed: true }));
      toast.success("Sync concluído");
      await load();
    } catch (e) {
      setSyncStatus(prev => ({ ...prev!, step: "Erro", errors: [(e as Error).message], completed: true }));
      toast.error("Sync falhou");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="integracao" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="integracao" className="gap-2"><Plug className="h-4 w-4" /> Configuração</TabsTrigger>
          <TabsTrigger value="auditoria" className="gap-2"><History className="h-4 w-4" /> Auditoria e Espelho</TabsTrigger>
        </TabsList>

        <TabsContent value="integracao" className="space-y-6">
          <ClinicorpIntegrationGuide />
          <ClinicorpUserCredentials onNextStep={() => {
            const auditTab = document.querySelector('[value="auditoria"]') as HTMLElement;
            auditTab?.click();
          }} />

          {/* Seção Administrador Sistema */}
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-primary" /><h4 className="text-sm font-semibold">Sistema (Admin)</h4></div>
              <Badge variant="outline" className="text-[10px]">Configuração Global</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Subscriber ID Global</Label>
                <Input value={subscriberId} onChange={(e) => setSubscriberId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Base URL Global</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleSave} disabled={saving}>Salvar Global</Button>
              <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>Sync Global</Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="auditoria">
          <ClinicorpAuditLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
