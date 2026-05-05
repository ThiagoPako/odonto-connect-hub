import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { saasApi } from "@/lib/saasApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, UserPlus, Pencil, UserX, UserCheck, KeyRound, RefreshCcw, Search } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/usuarios")({
  ssr: false,
  component: UsuariosPage,
});

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  avatar_url: string | null;
  created_at: string;
}

const ROLES = [
  { value: "admin", label: "Administrador" },
  { value: "dentista", label: "Dentista" },
  { value: "recepcionista", label: "Recepcionista" },
  { value: "comercial", label: "Comercial" },
  { value: "user", label: "Usuário" },
];

const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

function UsuariosPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPassword, setCPassword] = useState("");
  const [cRole, setCRole] = useState("user");
  const [creating, setCreating] = useState(false);

  // edit dialog
  const [editing, setEditing] = useState<TenantUser | null>(null);
  const [eName, setEName] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [eRole, setERole] = useState("user");
  const [saving, setSaving] = useState(false);

  // password dialog
  const [pwUser, setPwUser] = useState<TenantUser | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await saasApi.listTenantUsers();
    if (error) toast.error("Erro ao carregar usuários: " + error);
    else if (data) setUsers(data.data);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = async () => {
    if (!cName.trim() || !cEmail.trim() || cPassword.length < 6) {
      toast.error("Preencha nome, email e senha (mín. 6 caracteres)");
      return;
    }
    setCreating(true);
    const { error } = await saasApi.createTenantUser({
      name: cName.trim(),
      email: cEmail.trim(),
      password: cPassword,
      role: cRole,
    });
    setCreating(false);
    if (error) { toast.error(error); return; }
    toast.success("Usuário criado");
    setCreateOpen(false);
    setCName(""); setCEmail(""); setCPassword(""); setCRole("user");
    fetchUsers();
  };

  const openEdit = (u: TenantUser) => {
    setEditing(u);
    setEName(u.name);
    setEEmail(u.email);
    setERole(u.role);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    const { error } = await saasApi.updateTenantUser(editing.id, {
      name: eName.trim(),
      email: eEmail.trim(),
      role: eRole,
    });
    setSaving(false);
    if (error) { toast.error(error); return; }
    toast.success("Usuário atualizado");
    setEditing(null);
    fetchUsers();
  };

  const toggleActive = async (u: TenantUser) => {
    const { error } = await saasApi.updateTenantUser(u.id, { active: !u.active });
    if (error) { toast.error(error); return; }
    toast.success(u.active ? "Usuário desativado" : "Usuário reativado");
    fetchUsers();
  };

  const handleResetPw = async () => {
    if (!pwUser || pwValue.length < 6) {
      toast.error("Senha mínima 6 caracteres"); return;
    }
    setPwSaving(true);
    const { error } = await saasApi.resetTenantUserPassword(pwUser.id, pwValue);
    setPwSaving(false);
    if (error) { toast.error(error); return; }
    toast.success("Senha redefinida");
    setPwUser(null); setPwValue("");
  };

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Usuários" />
      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Usuários da clínica</h2>
            <p className="text-sm text-muted-foreground">
              Gerencie acessos da sua equipe
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-lg">Equipe</CardTitle>
                <CardDescription>{users.length} usuário(s) no tenant</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
                  <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <UserPlus className="h-4 w-4 mr-1" /> Novo usuário
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Criar usuário</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                      <div className="space-y-2">
                        <Label>Nome</Label>
                        <Input value={cName} onChange={(e) => setCName(e.target.value)} maxLength={100} />
                      </div>
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} maxLength={150} />
                      </div>
                      <div className="space-y-2">
                        <Label>Senha</Label>
                        <Input type="password" value={cPassword} onChange={(e) => setCPassword(e.target.value)} minLength={6} />
                      </div>
                      <div className="space-y-2">
                        <Label>Perfil de acesso</Label>
                        <Select value={cRole} onValueChange={setCRole}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                      <Button onClick={handleCreate} disabled={creating}>
                        {creating ? "Criando..." : "Criar"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, email ou perfil..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum usuário encontrado</p>
            ) : (
              <div className="divide-y rounded-xl border overflow-hidden">
                {filtered.map((u) => {
                  const initials = u.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <div key={u.id} className={`flex items-center gap-3 p-3 ${!u.active ? "opacity-50" : ""}`}>
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt={u.name} className="h-9 w-9 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-[11px] font-bold shrink-0">
                          {initials}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {u.name} {isSelf && <span className="text-xs text-muted-foreground">(você)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <Badge variant="outline" className="text-[11px] shrink-0">{roleLabel(u.role)}</Badge>
                      {!u.active && <Badge variant="destructive" className="text-[10px] shrink-0">Inativo</Badge>}
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)} title="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPwUser(u)} title="Redefinir senha">
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleActive(u)}
                          disabled={isSelf}
                          title={u.active ? "Desativar" : "Reativar"}
                        >
                          {u.active ? <UserX className="h-3.5 w-3.5 text-destructive" /> : <UserCheck className="h-3.5 w-3.5 text-primary" />}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Edit */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={eName} onChange={(e) => setEName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={eEmail} onChange={(e) => setEEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Perfil de acesso</Label>
              <Select value={eRole} onValueChange={setERole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password reset */}
      <Dialog open={!!pwUser} onOpenChange={(o) => { if (!o) { setPwUser(null); setPwValue(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Definir nova senha para <strong>{pwUser?.name}</strong>
            </p>
            <div className="space-y-2">
              <Label>Nova senha</Label>
              <Input type="password" value={pwValue} onChange={(e) => setPwValue(e.target.value)} minLength={6} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPwUser(null); setPwValue(""); }}>Cancelar</Button>
            <Button onClick={handleResetPw} disabled={pwSaving}>
              {pwSaving ? "Salvando..." : "Redefinir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
