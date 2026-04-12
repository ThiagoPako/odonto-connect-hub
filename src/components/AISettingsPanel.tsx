import { useState, useEffect } from "react";
import { Bot, Key, Save, Eye, EyeOff, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { vpsApiFetch } from "@/lib/vpsApi";

interface AIProvider {
  provider: string;
  label: string;
  description: string;
  api_key: string;
  model: string;
  enabled: boolean;
}

const DEFAULT_PROVIDERS: AIProvider[] = [
  {
    provider: "openai",
    label: "OpenAI",
    description: "Transcrição (Whisper) e geração de relatórios clínicos (GPT)",
    api_key: "",
    model: "gpt-4o-mini",
    enabled: false,
  },
  {
    provider: "manus",
    label: "Manus AI",
    description: "Análise de dados do Meta Ads e anúncios",
    api_key: "",
    model: "",
    enabled: false,
  },
];

export function AISettingsPanel() {
  const [providers, setProviders] = useState<AIProvider[]>(DEFAULT_PROVIDERS);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const { data } = await vpsApiFetch<AIProvider[]>("/ai/settings");
    if (data && Array.isArray(data)) {
      setProviders(prev =>
        prev.map(p => {
          const saved = data.find((s: AIProvider) => s.provider === p.provider);
          return saved
            ? { ...p, api_key: saved.api_key || "", model: saved.model || p.model, enabled: saved.enabled }
            : p;
        })
      );
    }
    setLoading(false);
  }

  async function saveProvider(provider: AIProvider) {
    setSaving(provider.provider);
    const { error } = await vpsApiFetch("/ai/settings", {
      method: "POST",
      body: {
        provider: provider.provider,
        api_key: provider.api_key,
        model: provider.model,
        enabled: provider.enabled,
      },
    });
    setSaving(null);
    if (error) {
      toast.error(`Erro ao salvar ${provider.label}: ${error}`);
    } else {
      toast.success(`${provider.label} salvo com sucesso`);
    }
  }

  function updateProvider(providerKey: string, field: keyof AIProvider, value: string | boolean) {
    setProviders(prev =>
      prev.map(p => (p.provider === providerKey ? { ...p, [field]: value } : p))
    );
  }

  if (loading) {
    return (
      <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Carregando configurações de IA...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">Integrações de IA</h3>
          <p className="text-xs text-muted-foreground">
            Configure as API keys para transcrição, relatórios e automações
          </p>
        </div>
      </div>

      {providers.map(provider => (
        <div
          key={provider.provider}
          className={`rounded-xl border p-4 space-y-3 transition-all ${
            provider.enabled
              ? "border-primary/30 bg-primary/5"
              : "border-border/40 bg-muted/20"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                provider.enabled ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {provider.provider === "openai" ? "AI" : "MA"}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{provider.label}</p>
                <p className="text-[11px] text-muted-foreground">{provider.description}</p>
              </div>
            </div>
            <button
              onClick={() => {
                updateProvider(provider.provider, "enabled", !provider.enabled);
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                provider.enabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  provider.enabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Key className="h-3 w-3" /> API Key
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKeys[provider.provider] ? "text" : "password"}
                  value={provider.api_key}
                  onChange={e => updateProvider(provider.provider, "api_key", e.target.value)}
                  placeholder={`Cole sua ${provider.label} API key aqui...`}
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                />
                <button
                  onClick={() => setShowKeys(prev => ({ ...prev, [provider.provider]: !prev[provider.provider] }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKeys[provider.provider] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {provider.provider === "openai" && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Modelo para Relatórios</label>
              <select
                value={provider.model}
                onChange={e => updateProvider(provider.provider, "model", e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="gpt-4o-mini">GPT-4o Mini (rápido e econômico)</option>
                <option value="gpt-4o">GPT-4o (alta qualidade)</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo (mais barato)</option>
              </select>
            </div>
          )}

          <button
            onClick={() => saveProvider(provider)}
            disabled={saving === provider.provider}
            className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving === provider.provider ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Salvar {provider.label}
          </button>

          {provider.provider === "openai" && provider.api_key && provider.enabled && (
            <div className="flex items-center gap-1.5 text-[11px] text-success">
              <Check className="h-3 w-3" />
              Pronto para transcrição e relatórios clínicos
            </div>
          )}
        </div>
      ))}

      <div className="bg-muted/30 rounded-lg p-3 border border-border/30">
        <p className="text-[11px] text-muted-foreground">
          <strong>Segurança:</strong> As API keys são armazenadas criptografadas no servidor VPS e nunca
          são expostas no frontend. Apenas o backend utiliza essas chaves para chamadas às APIs.
        </p>
      </div>
    </div>
  );
}
