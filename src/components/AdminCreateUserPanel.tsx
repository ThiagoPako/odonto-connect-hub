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
  const [comissaoError, setComissaoError] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeTarget, setCompleteTarget] = useState<CompleteDentistaTarget | null>(null);
  const [loading, setLoading] = useState(false);

  // Aceita apenas dígitos com até 2 casas decimais e bloqueia >100. Vazio é permitido (mostra erro).
  const handleComissaoChange = (raw: string) => {
    // Normaliza vírgula para ponto
    let v = raw.replace(",", ".").trim();
    // Permite vazio ou string que casa com o padrão progressivo
    if (v === "") {
      setComissao("");
      setComissaoError("Informe a comissão");
      return;
    }
    // Bloqueia caracteres não numéricos / múltiplos pontos / mais de 2 decimais
    if (!/^\d{0,3}(\.\d{0,2})?$/.test(v)) {
      // Não atualiza estado — input rejeita silenciosamente
      return;
    }
    const num = Number(v);
    if (Number.isFinite(num) && num > 100) {
      setComissao("100");
      setComissaoError(null);
      return;
    }
    setComissao(v);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      setComissaoError("Comissão deve estar entre 0 e 100");
    } else {
      setComissaoError(null);
    }
  };

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

    const comissaoNum = Number(comissao);
    if (role === "dentista") {
      if (!especialidade.trim()) {
        toast.error("Selecione uma especialidade");
        return;
      }
      if (comissaoError || !Number.isFinite(comissaoNum) || comissaoNum < 0 || comissaoNum > 100) {
        toast.error(comissaoError || "Comissão deve ser um número entre 0 e 100");
        return;
      }
      // Reforça regra de no máximo 2 casas decimais (defesa em profundidade)
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(comissao)) {
        toast.error("Comissão deve ter no máximo 2 casas decimais");
        return;
      }
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
        const existingComissao = Number(
          existing.comissao_percentual ?? existing.comissao
        );
        setCompleteTarget({
          id: existing.id,
          nome: existing.nome || userName,
          email: existing.email || userEmail,
          telefone: existing.telefone || "",
          cro: existing.cro || "",
          especialidade: existing.especialidade || especialidade,
          comissao: Number.isFinite(existingComissao) ? existingComissao : comissaoNum,
        });
        setCompleteOpen(true);
      } else {
        const { data: createdDent, error: dErr } = await dentistasApi.create({
          nome: userName,
          email: userEmail,
          telefone: "",
          cro: "",
          especialidade,
          comissao_percentual: comissaoNum,
          ativo: true,
        });

        if (dErr) {
          toast.error(`Resumo do cadastro de ${createdName}`, {
            description: `✓ Usuário criado com sucesso\n✗ Falha ao criar em /dentistas: ${dErr}\n\nAcesse /dentistas e cadastre manualmente para aparecer na agenda.`,
            duration: 10000,
          });
        } else {
          toast.success(`Resumo do cadastro de ${createdName}`, {
            description: `✓ Usuário criado com sucesso\n✓ Registro em /dentistas criado (${especialidade}, ${comissaoNum}%)\n✓ Disponível na Agenda`,
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
              especialidade,
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
    setEspecialidade("Clínica Geral");
    setComissao("35");
    setComissaoError(null);
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

            {role === "dentista" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="user-especialidade">Especialidade</Label>
                  <Select value={especialidade} onValueChange={setEspecialidade}>
                    <SelectTrigger id="user-especialidade">
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
                <div className="space-y-2">
                  <Label htmlFor="user-comissao">Comissão (%)</Label>
                  <Input
                    id="user-comissao"
                    type="text"
                    inputMode="decimal"
                    placeholder="35"
                    value={comissao}
                    onChange={(e) => handleComissaoChange(e.target.value)}
                    aria-invalid={!!comissaoError}
                    aria-describedby="user-comissao-hint"
                    className={comissaoError ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
                  <p
                    id="user-comissao-hint"
                    className={`text-xs ${comissaoError ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {comissaoError ?? "Valor entre 0 e 100, até 2 casas decimais."}
                  </p>
                </div>
              </>
            )}
          </div>
          <Button
            type="submit"
            disabled={loading || (role === "dentista" && !!comissaoError)}
            className="w-full sm:w-auto"
          >
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
