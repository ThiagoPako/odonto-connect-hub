import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { mascaraTelefoneBR, erroTelefoneBR, telefoneParaServidor } from "@/lib/mascaraTelefone";
import { contatosApi, type Contato } from "@/lib/vpsApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (contato: Contato) => void;
}

export function CreateContatoDialog({ open, onOpenChange, onCreated }: Props) {
  const [form, setForm] = useState({ nome: "", telefone: "", email: "", tipo: "pessoal", empresa: "", cargo: "", observacoes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!form.nome.trim()) return setError("Informe o nome do contato.");
    const telErro = erroTelefoneBR(form.telefone);
    if (telErro) return setError(telErro);
    setLoading(true);
    setError(null);
    // Máscara só na tela: o servidor recebe 55 + DDD + número, só dígitos.
    const { data, error: apiError } = await contatosApi.create({ ...form, telefone: telefoneParaServidor(form.telefone) });
    setLoading(false);
    if (apiError) return setError(apiError);
    if (data) {
      onCreated(data);
      onOpenChange(false);
      setForm({ nome: "", telefone: "", email: "", tipo: "pessoal", empresa: "", cargo: "", observacoes: "" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Contato</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="novo-contato-nome">Nome *</Label>
              <Input id="novo-contato-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="novo-contato-tel">Telefone</Label>
              <Input id="novo-contato-tel" type="tel" inputMode="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: mascaraTelefoneBR(e.target.value) })}
                aria-invalid={!!erroTelefoneBR(form.telefone)} placeholder="(11) 99999-9999" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="novo-contato-email">Email</Label>
              <Input id="novo-contato-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pessoal">Pessoal</SelectItem>
                  <SelectItem value="paciente">Paciente</SelectItem>
                  <SelectItem value="fornecedor">Fornecedor</SelectItem>
                  <SelectItem value="parceiro">Parceiro</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} placeholder="Nome da empresa" />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Cargo</Label>
              <Input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder="Ex: Gerente Comercial" />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Observações</Label>
              <Input value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Notas adicionais..." />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Criar Contato
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
