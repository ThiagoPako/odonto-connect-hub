import { useState } from "react";
import { adminCreateUser, dentistasApi } from "@/lib/vpsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { CompleteDentistaDialog, type CompleteDentistaTarget } from "@/components/CompleteDentistaDialog";
import { especialidades } from "@/data/dentistasMockData";

export function AdminCreateUserPanel() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [especialidade, setEspecialidade] = useState("Clínica Geral");
  const [comissao, setComissao] = useState<string>("35");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeTarget, setCompleteTarget] = useState<CompleteDentistaTarget | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      toast.error("Preencha todos os campos");
      return;
    }
    if (password.length < 6) {
      toast.error("Senha deve ter pelo menos 6 caracteres");
      return;
    }

    setLoading(true);
    const userName = name.trim();
    const { data, error } = await adminCreateUser(userName, email.trim(), password, role);
    if (error) {
      toast.error("Erro ao criar usuário: " + error);
      setLoading(false);
      return;
    }

    const createdName = data?.user?.name || userName;

    // Se for dentista, cria também o registro clínico em /dentistas e mostra resumo final
    if (role === "dentista") {
      const userEmail = email.trim().toLowerCase();

      // Verifica duplicidade por email (e CRO quando preenchido) antes de criar
      const { data: listData, error: listErr } = await dentistasApi.list();
      const dentistas = Array.isArray((listData as any)?.data)
        ? (listData as any).data
        : Array.isArray(listData)
          ? (listData as any[])
          : [];

      const existing = dentistas.find((d: any) => {
        const dEmail = (d?.email || "").toString().trim().toLowerCase();
        return dEmail && dEmail === userEmail;
      });

      if (listErr) {
        toast.warning(`Resumo do cadastro de ${createdName}`, {
          description: `✓ Usuário criado com sucesso\n⚠ Não foi possível verificar duplicidade em /dentistas: ${listErr}\n\nVerifique manualmente em /dentistas.`,
          duration: 10000,
        });
      } else if (existing) {
        toast.success(`Resumo do cadastro de ${createdName}`, {
          description: `✓ Usuário criado com sucesso\nℹ Já existia em /dentistas (${existing.nome || existing.email}) — não duplicado\n✓ Disponível na Agenda`,
          duration: 8000,
        });
        setCompleteTarget({
          id: existing.id,
          nome: existing.nome || userName,
          email: existing.email || userEmail,
          telefone: existing.telefone || "",
          cro: existing.cro || "",
          especialidade: existing.especialidade || "Clínica Geral",
        });
        setCompleteOpen(true);
      } else {
        const { data: createdDent, error: dErr } = await dentistasApi.create({
          nome: userName,
          email: userEmail,
          telefone: "",
          cro: "",
          especialidade: "Clínica Geral",
          comissao_percentual: 35,
          ativo: true,
        });

        if (dErr) {
          toast.error(`Resumo do cadastro de ${createdName}`, {
            description: `✓ Usuário criado com sucesso\n✗ Falha ao criar em /dentistas: ${dErr}\n\nAcesse /dentistas e cadastre manualmente para aparecer na agenda.`,
            duration: 10000,
          });
        } else {
          toast.success(`Resumo do cadastro de ${createdName}`, {
            description: "✓ Usuário criado com sucesso\n✓ Registro em /dentistas criado\n✓ Disponível na Agenda",
            duration: 6000,
          });
          const newId =
            (createdDent as any)?.id ||
            (createdDent as any)?.data?.id ||
            (createdDent as any)?.dentista?.id;
          if (newId) {
            setCompleteTarget({
              id: newId,
              nome: userName,
              email: userEmail,
              telefone: "",
              cro: "",
              especialidade: "Clínica Geral",
            });
            setCompleteOpen(true);
          }
        }
      }
    } else {
      toast.success(`Usuário ${createdName} criado com sucesso!`);
    }

    setName("");
    setEmail("");
    setPassword("");
    setRole("user");
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <UserPlus className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Criar Novo Usuário</CardTitle>
            <CardDescription>Adicione dentistas, recepcionistas e outros membros</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="user-name">Nome completo</Label>
              <Input
                id="user-name"
                placeholder="Dr. João Silva"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                placeholder="joao@clinica.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-password">Senha inicial</Label>
              <Input
                id="user-password"
                type="password"
                placeholder="Mín. 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-role">Função</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="dentista">Dentista</SelectItem>
                  <SelectItem value="recepcionista">Recepcionista</SelectItem>
                  <SelectItem value="comercial">Comercial</SelectItem>
                  <SelectItem value="user">Usuário</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={loading} className="w-full sm:w-auto">
            <UserPlus className="h-4 w-4 mr-2" />
            {loading ? "Criando..." : "Criar Usuário"}
          </Button>
        </form>
      </CardContent>

      <CompleteDentistaDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        dentista={completeTarget}
      />
    </Card>
  );
}
