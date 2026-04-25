import { useState, useEffect } from "react";
import { dentistasApi } from "@/lib/vpsApi";
import { especialidades } from "@/data/dentistasMockData";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Stethoscope, Loader2 } from "lucide-react";

export interface CompleteDentistaTarget {
  id: string;
  nome: string;
  email: string;
  telefone?: string;
  cro?: string;
  especialidade?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dentista: CompleteDentistaTarget | null;
  onCompleted?: () => void;
}

function formatTelefone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function CompleteDentistaDialog({
  open,
  onOpenChange,
  dentista,
  onCompleted,
}: Props) {
  const [telefone, setTelefone] = useState("");
  const [cro, setCro] = useState("");
  const [especialidade, setEspecialidade] = useState("Clínica Geral");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dentista) {
      setTelefone(dentista.telefone || "");
      setCro(dentista.cro || "");
      setEspecialidade(dentista.especialidade || "Clínica Geral");
    }
  }, [dentista]);

  if (!dentista) return null;

  const handleSave = async () => {
    const telDigits = telefone.replace(/\D/g, "");
    if (telDigits && (telDigits.length < 10 || telDigits.length > 11)) {
      toast.error("Telefone inválido. Use 10 ou 11 dígitos.");
      return;
    }
    if (cro.trim() && cro.trim().length < 4) {
      toast.error("CRO deve ter pelo menos 4 caracteres.");
      return;
    }
    if (!especialidade.trim()) {
      toast.error("Selecione uma especialidade.");
      return;
    }

    setSaving(true);
    const { error } = await dentistasApi.update(dentista.id, {
      telefone: telefone.trim(),
      cro: cro.trim(),
      especialidade,
    });
    setSaving(false);

    if (error) {
      toast.error("Erro ao salvar: " + error);
      return;
    }

    toast.success("Dados do dentista atualizados!");
    onCompleted?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Stethoscope className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Completar dados do dentista</DialogTitle>
              <DialogDescription>
                {dentista.nome} — {dentista.email}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="dentista-telefone">Telefone</Label>
            <Input
              id="dentista-telefone"
              placeholder="(11) 91234-5678"
              value={telefone}
              onChange={(e) => setTelefone(formatTelefone(e.target.value))}
              maxLength={16}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dentista-cro">CRO</Label>
            <Input
              id="dentista-cro"
              placeholder="Ex: CRO-SP 12345"
              value={cro}
              onChange={(e) => setCro(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dentista-especialidade">Especialidade</Label>
            <Select value={especialidade} onValueChange={setEspecialidade}>
              <SelectTrigger id="dentista-especialidade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {especialidades.map((esp) => (
                  <SelectItem key={esp} value={esp}>
                    {esp}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Pular por enquanto
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {saving ? "Salvando..." : "Salvar dados"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
