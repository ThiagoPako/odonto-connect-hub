import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MapPin, Save, Copy, ExternalLink } from "lucide-react";

const STORAGE_KEY = "odonto_clinic_location";

interface ClinicLocation {
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

export function getClinicLocation(): ClinicLocation | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function getLocationMessage(): string {
  const loc = getClinicLocation();
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

export function ClinicLocationPanel() {
  const [location, setLocation] = useState<ClinicLocation>(emptyLocation);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = getClinicLocation();
    if (stored) {
      setLocation(stored);
      setSaved(true);
    }
  }, []);

  const handleSave = () => {
    if (!location.name.trim() || !location.address.trim()) {
      toast.error("Nome e endereço são obrigatórios");
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    setSaved(true);
    toast.success("Localização salva com sucesso!");
  };

  const handleCopy = () => {
    const msg = getLocationMessage();
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
              Endereço compartilhado automaticamente com leads e pacientes
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2 sm:col-span-2">
            <Label>Nome da clínica *</Label>
            <Input
              placeholder="Odonto Connect Clínica"
              value={location.name}
              onChange={(e) => update("name", e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Endereço completo *</Label>
            <Input
              placeholder="Rua Exemplo, 123 - Sala 45"
              value={location.address}
              onChange={(e) => update("address", e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label>Cidade</Label>
            <Input
              placeholder="São Paulo"
              value={location.city}
              onChange={(e) => update("city", e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Estado</Label>
              <Input
                placeholder="SP"
                value={location.state}
                onChange={(e) => update("state", e.target.value)}
                maxLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label>CEP</Label>
              <Input
                placeholder="01234-567"
                value={location.zip}
                onChange={(e) => update("zip", e.target.value)}
                maxLength={10}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Telefone / WhatsApp</Label>
            <Input
              placeholder="(11) 99999-9999"
              value={location.phone}
              onChange={(e) => update("phone", e.target.value)}
              maxLength={20}
            />
          </div>
          <div className="space-y-2">
            <Label>Link do Google Maps</Label>
            <Input
              placeholder="https://maps.google.com/..."
              value={location.googleMapsUrl}
              onChange={(e) => update("googleMapsUrl", e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            {saved ? "Salvo ✓" : "Salvar Localização"}
          </Button>
          <Button variant="outline" onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-2" />
            Copiar Mensagem
          </Button>
          {location.googleMapsUrl && (
            <a href={location.googleMapsUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline">
                <ExternalLink className="h-4 w-4 mr-2" />
                Abrir Mapa
              </Button>
            </a>
          )}
        </div>

        {saved && (
          <div className="rounded-xl border bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Prévia da mensagem:</p>
            <pre className="text-sm whitespace-pre-wrap text-foreground">{getLocationMessage()}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
