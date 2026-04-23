import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { crmApi } from "@/lib/vpsApi";
import { CANAIS, getCampanhas, getPendingUtm, linkLeadToCampaign } from "@/data/campanhasStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

const origens = ["WhatsApp", "Google Ads", "Meta Ads", "Instagram", "TikTok", "YouTube", "Indicação", "Site", "Telefone", "Outro"];
const responsaveis = ["Ana", "Beatriz", "Carla", "Dr. Marcos", "Dr. Paula"];

export function CreateLeadDialog({ open, onOpenChange, onCreated }: Props) {
  const [form, setForm] = useState({ nome: "", telefone: "", email: "", origem: "WhatsApp", value: "", responsavel: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCampaign, setPendingCampaign] = useState<{ nome: string; canal: string } | null>(null);

  // Detecta UTM pendente quando o dialog abre
  useEffect(() => {
    if (!open) return;
    const pending = getPendingUtm();
    if (!pending) {
      setPendingCampaign(null);
      return;
    }
    const camp = getCampanhas().find((c) => c.id === pending.campaignId);
    const canal = CANAIS.find((c) => c.id === pending.canal);
    if (camp && canal) {
      setPendingCampaign({ nome: camp.nome, canal: canal.label });
      setForm((f) => ({ ...f, origem: canal.label.split(" (")[0] }));
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!form.nome.trim()) return setError("Nome é obrigatório");
    setLoading(true);
    setError(null);
    const { data, error: apiError } = await crmApi.create({
      nome: form.nome.trim(),
      telefone: form.telefone.trim() || undefined,
      email: form.email.trim() || undefined,
      origem: form.origem,
      value: form.value ? Number(form.value) : undefined,
    });
    setLoading(false);
    if (apiError) return setError(apiError);
    if (data) {
      // Vincula lead à campanha de origem (se houver UTM pendente)
      const linked = linkLeadToCampaign(data.id ?? form.nome, form.nome.trim());
      if (linked) {
        toast.success(`Lead vinculado à campanha "${linked.campaign.nome}" (${CANAIS.find((c) => c.id === linked.canal)?.label})`);
      }
      onCreated();
      onOpenChange(false);
      setForm({ nome: "", telefone: "", email: "", origem: "WhatsApp", value: "", responsavel: "" });
      setPendingCampaign(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Lead / Paciente</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Nome *</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="(11) 99999-9999" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" />
            </div>
            <div className="space-y-2">
              <Label>Origem</Label>
              <Select value={form.origem} onValueChange={(v) => setForm({ ...form, origem: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {origens.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor estimado (R$)</Label>
              <Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="0" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Responsável</Label>
              <Select value={form.responsavel} onValueChange={(v) => setForm({ ...form, responsavel: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar responsável" /></SelectTrigger>
                <SelectContent>
                  {responsaveis.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Cadastrar Lead
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
