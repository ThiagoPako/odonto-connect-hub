import { useEffect, useState } from "react";
import { clinicorpApi, type ClinicorpUserSettings, type ClinicorpConnectionTest, generateWebhookSecret, buildWebhookUrl } from "@/lib/clinicorpApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Copy, RefreshCw, Trash2, Loader2, Lock, PlugZap, CheckCircle2, XCircle, AlertCircle, RefreshCcw } from "lucide-react";

const DEFAULT_BASE = "https://api.clinicorp.com/rest/v1";

export function ClinicorpUserCredentials({ onNextStep }: { onNextStep?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ClinicorpUserSettings | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [subscriberId, setSubscriberId] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE);
  const [apiToken, setApiToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ClinicorpConnectionTest | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);


  async function load() {
    setLoading(true);
    try {
      const s = await clinicorpApi.getMySettings();
      setSettings(s);
      setEnabled(s.enabled);
      setSubscriberId(s.subscriber_id || "");
      setBaseUrl(s.base_url || DEFAULT_BASE);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar credenciais");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function validate(): string | null {
    if (subscriberId && subscriberId.length > 128) return "subscriber_id muito longo";
    if (baseUrl) {
      try { new URL(baseUrl); } catch { return "URL base inválida"; }
    }
    if (apiToken && (apiToken.length < 8 || apiToken.length > 2048)) return "API token deve ter entre 8 e 2048 caracteres";
    if (webhookSecret && (webhookSecret.length < 8 || webhookSecret.length > 256)) return "Webhook secret deve ter entre 8 e 256 caracteres";
    return null;
  }

  async function save() {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      await clinicorpApi.saveMySettings({
        enabled,
        subscriber_id: subscriberId,
        base_url: baseUrl,
        api_token: apiToken,
        webhook_secret: webhookSecret,
      });
      setApiToken("");
      setWebhookSecret("");
      toast.success("Credenciais salvas com segurança");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Remover suas credenciais Clinicorp? Você precisará reconectar para sincronizar novamente.")) return;
    try {
      await clinicorpApi.deleteMySettings();
      toast.success("Credenciais removidas");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover");
    }
  }

  async function testConnection() {
    const err = validate();
    if (err) { toast.error(err); return; }
    if (!apiToken && !settings?.has_api_token) { toast.error("Informe o API Token para testar"); return; }
    if (!subscriberId) { toast.error("Informe o Subscriber ID para testar"); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await clinicorpApi.testMyConnection({
        api_token: apiToken || undefined,
        subscriber_id: subscriberId,
        base_url: baseUrl,
      });
      setTestResult(result);
      if (result.ok) toast.success(`Conexão OK em ${result.total_latency_ms}ms`);
      else if (result.auth === "invalid_token") toast.error("Token inválido ou sem permissão");
      else toast.warning("Alguns endpoints falharam — veja detalhes");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao testar";
      setTestResult({ ok: false, auth: "invalid_token", total_latency_ms: 0, base_url: baseUrl, subscriber_id: subscriberId, error: msg, results: [] });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await clinicorpApi.syncMyNow();
      toast.success(`Sincronização ${result.status}: ${Object.values(result.summary).reduce((a, b) => a + b, 0)} itens processados`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`));
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </CardContent>
      </Card>
    );
  }

  const steps = [
    { id: 1, title: "Autenticação", icon: KeyRound, description: "Subscriber ID e API Token" },
    { id: 2, title: "Validação", icon: PlugZap, description: "Teste sua conexão" },
    { id: 3, title: "Tempo Real", icon: RefreshCw, description: "Configuração do Webhook" },
    { id: 4, title: "Sincronização", icon: RefreshCcw, description: "Importação inicial de dados" }
  ];

  return (
    <Card className="border-primary/10">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Configuração da Integração Clinicorp
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5 mt-1">
              <Lock className="h-3 w-3" /> Privadas — só você acessa essas chaves nesta conta.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {settings?.has_api_token && <Badge variant="secondary" className="bg-blue-500/10 text-blue-700 dark:text-blue-400">Token Ativo</Badge>}
            {settings?.enabled && <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Conectado</Badge>}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Wizard Progress Stepper */}
        <div className="relative mb-8 pt-4">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-muted -translate-y-1/2" />
          <div className="relative flex justify-between">
            {steps.map((step) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              const isCompleted = currentStep > step.id;
              
              return (
                <div key={step.id} className="flex flex-col items-center gap-2 z-10 bg-card px-2">
                  <button
                    onClick={() => step.id < currentStep || isCompleted || settings?.has_api_token ? setCurrentStep(step.id) : null}
                    disabled={step.id > currentStep && !settings?.has_api_token}
                    className={cn(
                      "h-8 w-8 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                      isActive ? "border-primary bg-primary text-primary-foreground scale-110 shadow-lg shadow-primary/20" : 
                      isCompleted ? "border-emerald-500 bg-emerald-500 text-white" : 
                      "border-muted bg-muted/50 text-muted-foreground"
                    )}
                  >
                    {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </button>
                  <div className="flex flex-col items-center">
                    <span className={cn("text-[10px] font-bold uppercase tracking-wider", isActive ? "text-primary" : "text-muted-foreground")}>
                      {step.title}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 1: Authentication */}
        {currentStep === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cc-sub" className="text-sm font-semibold">ID Central / Usuário API</Label>
                <Input 
                  id="cc-sub" 
                  placeholder="Ex.: sua-clinica" 
                  value={subscriberId} 
                  onChange={(e) => setSubscriberId(e.target.value)} 
                  maxLength={128}
                  className="bg-muted/30"
                />
                <p className="text-[10px] text-muted-foreground">O campo "Usuário API" do painel da Clinicorp.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cc-url" className="text-sm font-semibold">URL base da API</Label>
                <Input 
                  id="cc-url" 
                  type="url" 
                  value={baseUrl} 
                  onChange={(e) => setBaseUrl(e.target.value)} 
                  placeholder={DEFAULT_BASE}
                  className="bg-muted/30"
                />
                <p className="text-[10px] text-muted-foreground">Padrão oficial da Clinicorp.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cc-token" className="text-sm font-semibold">Token API (Bearer)</Label>
              <div className="relative">
                <Input
                  id="cc-token"
                  type={showToken ? "text" : "password"}
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder={settings?.has_api_token ? "•••••••• (Token já configurado)" : "Cole o Token API gerado na Clinicorp"}
                  autoComplete="off"
                  className="bg-muted/30"
                />
                <button 
                  type="button" 
                  onClick={() => setShowToken((v) => !v)} 
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">Criptografado com segurança no servidor.</p>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={async () => { await save(); setCurrentStep(2); }} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Salvar e Continuar
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Validation */}
        {currentStep === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="p-4 rounded-xl bg-muted/20 border border-dashed border-muted-foreground/20 text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <PlugZap className="h-6 w-6 text-primary" />
              </div>
              <div className="max-w-xs mx-auto space-y-1">
                <h4 className="text-sm font-semibold">Validar Conexão</h4>
                <p className="text-xs text-muted-foreground">Vamos verificar se as chaves fornecidas têm acesso aos dados da Clinicorp.</p>
              </div>
              
              <Button 
                variant={testResult?.ok ? "outline" : "default"} 
                onClick={testConnection} 
                disabled={testing}
                className="gap-2"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {testResult?.ok ? "Testar Novamente" : "Verificar Acesso"}
              </Button>
            </div>

            {testResult && (
              <div className={cn(
                "rounded-xl border p-4 space-y-3",
                testResult.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
              )}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {testResult.ok ? (
                    <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Acesso Validado com Sucesso</>
                  ) : (
                    <><XCircle className="h-4 w-4 text-destructive" /> Falha na Validação</>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground uppercase font-mono">{testResult.total_latency_ms}ms</span>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  {testResult.results.map((r) => (
                    <div key={r.key} className="flex items-center gap-2 p-2 rounded bg-background/50 border border-border/50 text-[11px]">
                      {r.ok ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertCircle className="h-3 w-3 text-destructive" />}
                      <span className="flex-1 font-medium">{r.label}</span>
                      <span className="text-muted-foreground">{r.count ?? 0} reg.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => setCurrentStep(1)}>Voltar</Button>
              <Button onClick={() => setCurrentStep(3)} disabled={!testResult?.ok} className="gap-2">
                Prosseguir para Webhook <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Webhook */}
        {currentStep === 3 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5">
                <div className="flex gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Webhook className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cc-enabled" className="text-sm font-bold">Ativar Atualização Automática</Label>
                    <p className="text-[10px] text-muted-foreground">Receba novos agendamentos e pacientes instantaneamente.</p>
                  </div>
                </div>
                <Switch id="cc-enabled" checked={enabled} onCheckedChange={(val) => { setEnabled(val); save(); }} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cc-secret" className="text-sm font-semibold">Chave de Segurança (Webhook Secret)</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="cc-secret"
                      type={showSecret ? "text" : "password"}
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      placeholder={settings?.has_webhook_secret ? `Configurado: ${settings.webhook_secret_preview}` : "Gere um secret e cole na Clinicorp"}
                      className="bg-muted/30 font-mono text-xs"
                    />
                    <button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setWebhookSecret(generateWebhookSecret(40))}>
                    Gerar
                  </Button>
                </div>
              </div>

              {webhookSecret && (
                <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-primary uppercase tracking-wider">URL de Destino (Endpoint)</span>
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-[10px]" onClick={() => copy(buildWebhookUrl(webhookSecret), "URL")}>
                      <Copy className="h-3 w-3" /> Copiar URL
                    </Button>
                  </div>
                  <code className="text-[11px] block p-2 bg-background border rounded font-mono break-all text-muted-foreground">
                    {buildWebhookUrl(webhookSecret)}
                  </code>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => setCurrentStep(2)}>Voltar</Button>
              <Button onClick={() => { save(); setCurrentStep(4); }} className="gap-2">
                Configurar Sincronização Inicial <RefreshCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Final Sync */}
        {currentStep === 4 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="p-8 rounded-2xl bg-muted/10 border border-border text-center space-y-4">
              <div className={cn(
                "mx-auto h-20 w-20 rounded-full flex items-center justify-center transition-all duration-500",
                syncing ? "bg-primary/5 animate-pulse" : "bg-emerald-500/10"
              )}>
                <RefreshCcw className={cn("h-10 w-10 text-primary transition-transform duration-1000", syncing && "rotate-180")} />
              </div>
              <div className="space-y-2 max-w-sm mx-auto">
                <h4 className="text-lg font-bold">Tudo pronto!</h4>
                <p className="text-sm text-muted-foreground">
                  Deseja realizar a primeira sincronização agora? Vamos importar pacientes, dentistas e agendamentos para criar o espelho.
                </p>
              </div>
              
              <div className="flex flex-col items-center gap-3">
                <Button 
                  size="lg" 
                  onClick={syncNow} 
                  disabled={syncing}
                  className="w-full max-w-xs gap-2 shadow-lg shadow-primary/20"
                >
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                  {syncing ? "Sincronizando Dados..." : "Iniciar Sincronização"}
                </Button>
                
                {onNextStep && (
                  <Button variant="link" onClick={onNextStep} className="text-muted-foreground hover:text-primary">
                    Ir para o Log de Auditoria
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-border/40">
           <Button variant="ghost" size="sm" onClick={remove} className="text-destructive hover:bg-destructive/5 text-xs" disabled={!settings?.has_api_token && !settings?.enabled}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remover credenciais
          </Button>
          <div className="text-[10px] text-muted-foreground">
            Status: {settings?.enabled ? "Conectado" : "Pendente"}
          </div>
        </div>
      </CardContent>
    </Card>

  );
}
