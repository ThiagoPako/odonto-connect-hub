import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { MapPin, Save, Copy, ExternalLink, AlertCircle, Lock, Loader2 } from "lucide-react";
import { vpsApiFetch } from "@/lib/vpsApi";
import { useAuth } from "@/hooks/useAuth";

// Chave antiga: a localização ficava só no navegador de quem salvou. Hoje é da clínica (servidor).
const LEGACY_STORAGE_KEY = "odonto_clinic_location";

export interface ClinicLocation {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  googleMapsUrl: string;
  phone: string;
}

const emptyLocation: ClinicLocation = {
  name: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  googleMapsUrl: "",
  phone: "",
};

const clinicLocationApi = {
  get: () => vpsApiFetch<ClinicLocation | null>("/clinic-location", { background: true }),
  update: (body: ClinicLocation) =>
    vpsApiFetch<{ success: boolean; location: ClinicLocation }>("/clinic-location", { method: "PUT", body }),
};

// Cópia em memória da localização da clínica (vinda do servidor), para quem precisa dela
// de forma síncrona, como o botão "Localização" do chat.
let cachedLocation: ClinicLocation | null = null;
let pendingFetch: Promise<ClinicLocation | null> | null = null;

/** Lê a localização da clínica no servidor e atualiza a cópia em memória. Nunca lança. */
export async function fetchClinicLocation(): Promise<{ location: ClinicLocation | null; error: string | null }> {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* navegador sem localStorage: nada a limpar */
    }
  }
  const { data, error } = await clinicLocationApi.get();
  if (error) return { location: null, error };
  cachedLocation = data && data.name && data.address ? { ...emptyLocation, ...data } : null;
  return { location: cachedLocation, error: null };
}

/**
 * Localização já carregada do servidor (ou null). Na primeira chamada dispara a leitura em
 * segundo plano; a tela que chamar de novo depois de um novo render recebe o valor.
 */
export function getClinicLocation(): ClinicLocation | null {
  if (typeof window === "undefined") return null;
  if (!cachedLocation && !pendingFetch) {
    pendingFetch = fetchClinicLocation().then(({ location }) => location);
  }
  return cachedLocation;
}

function buildLocationMessage(loc: ClinicLocation | null): string {
  if (!loc) return "";
  const parts = [
    loc.name && `📍 *${loc.name}*`,
    loc.address && `📌 ${loc.address}`,
    (loc.city || loc.state) && `🏙️ ${[loc.city, loc.state].filter(Boolean).join(" - ")}`,
    loc.zip && `CEP: ${loc.zip}`,
    loc.phone && `📞 ${loc.phone}`,
    loc.googleMapsUrl && `🗺️ ${loc.googleMapsUrl}`,
  ].filter(Boolean);
  return parts.join("\n");
}

export function getLocationMessage(): string {
  return buildLocationMessage(getClinicLocation());
}

function isForbiddenError(error: string) {
  return /admin access required|HTTP 403|sem clínica/i.test(error);
}

type LoadState = "loading" | "ready" | "error";

export function ClinicLocationPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || !!user?.is_super_admin;
  const [location, setLocation] = useState<ClinicLocation>(emptyLocation);
  const [saved, setSaved] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const readOnly = !isAdmin || forbidden;

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    const { location: loaded, error } = await fetchClinicLocation();
    if (error) {
      setLoadError(error);
      setLoadState("error");
      return;
    }
    setLocation(loaded ?? emptyLocation);
    setSaved(!!loaded);
    setLoadState("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (readOnly || saving) return;
    if (!location.name.trim() || !location.address.trim()) {
      toast.error("Nome e endereço são obrigatórios");
      return;
    }
    if (location.googleMapsUrl.trim() && !/^https:\/\//i.test(location.googleMapsUrl.trim())) {
      toast.error("O link do mapa precisa começar com https://");
      return;
    }
    setSaving(true);
    const { data, error } = await clinicLocationApi.update(location);
    setSaving(false);
    if (error) {
      if (isForbiddenError(error)) {
        setForbidden(true);
        toast.error("Só o administrador da clínica pode alterar a localização.");
      } else {
        toast.error(`Não foi possível salvar: ${error}`);
      }
      return;
    }
    const savedLocation = data?.location ?? location;
    cachedLocation = savedLocation;
    setLocation(savedLocation);
    setSaved(true);
    toast.success("Localização da clínica salva", {
      description: "Vale para toda a equipe, em qualquer computador ou celular.",
    });
  };

  const handleCopy = () => {
    const msg = buildLocationMessage(saved ? location : null);
    if (!msg) {
      toast.error("Salve a localização primeiro");
      return;
    }
    navigator.clipboard.writeText(msg);
    toast.success("Localização copiada!");
  };

  const update = (field: keyof ClinicLocation, value: string) => {
    setLocation((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-chart-2/10 flex items-center justify-center">
            <MapPin className="h-5 w-5 text-chart-2" />
          </div>
          <div>
            <CardTitle className="text-lg">Localização da Clínica</CardTitle>
            <CardDescription>
              Endereço que você envia para leads e pacientes pelo chat
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadState === "loading" && (
          <div className="space-y-3" aria-busy="true" aria-live="polite">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando a localização da clínica...
            </p>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}

        {loadState === "error" && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Não foi possível carregar a localização</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{loadError}</p>
              <p>Nada foi alterado. Tente de novo para não apagar o endereço que a clínica já salvou.</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {loadState === "ready" && (
        <>
        {readOnly && (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertTitle>Somente leitura</AlertTitle>
            <AlertDescription>
              Só o administrador da clínica pode alterar a localização. Ela vale para toda a equipe.
            </AlertDescription>
          </Alert>
        )}
        <fieldset disabled={readOnly} className="min-w-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="loc-name">Nome da clínica *</Label>
            <Input
              placeholder="Clínica Sorriso"
              value={location.name}
              id="loc-name"
              onChange={(e) => update("name", e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="loc-address">Endereço completo *</Label>
            <Input
              placeholder="Rua Exemplo, 123 - Sala 45"
              value={location.address}
              id="loc-address"
              onChange={(e) => update("address", e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="loc-city">Cidade</Label>
            <Input
              placeholder="São Paulo"
              value={location.city}
              id="loc-city"
              onChange={(e) => update("city", e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="loc-state">Estado</Label>
              <Input
                placeholder="SP"
                value={location.state}
                id="loc-state"
              onChange={(e) => update("state", e.target.value)}
                maxLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-zip">CEP</Label>
              <Input
                placeholder="01234-567"
                value={location.zip}
                id="loc-zip"
              onChange={(e) => update("zip", e.target.value)}
                maxLength={10}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="loc-phone">Telefone / WhatsApp</Label>
            <Input
              placeholder="(11) 99999-9999"
              value={location.phone}
              id="loc-phone"
              onChange={(e) => update("phone", e.target.value)}
              maxLength={20}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="loc-googleMapsUrl">Link do Google Maps</Label>
            <Input
              placeholder="https://maps.google.com/..."
              value={location.googleMapsUrl}
              id="loc-googleMapsUrl"
              onChange={(e) => update("googleMapsUrl", e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        </fieldset>

        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {saving ? "Salvando..." : saved ? "Salvo ✓" : "Salvar localização"}
            </Button>
          )}
          <Button variant="outline" onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-2" />
            Copiar mensagem
          </Button>
          {/^https:\/\//i.test(location.googleMapsUrl) && (
            <Button variant="outline" asChild>
              <a href={location.googleMapsUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Abrir mapa
              </a>
            </Button>
          )}
        </div>

        {saved && (
          <div className="rounded-xl border bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Prévia da mensagem:</p>
            <pre className="text-sm whitespace-pre-wrap text-foreground">{buildLocationMessage(location)}</pre>
          </div>
        )}
        </>
        )}
      </CardContent>
    </Card>
  );
}
