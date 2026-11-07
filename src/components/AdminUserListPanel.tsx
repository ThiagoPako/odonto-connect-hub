import { useState, useEffect, useRef } from "react";
import { adminListUsers, adminUpdateUser, adminUploadUserAvatar } from "@/lib/vpsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { Users, RefreshCcw, Pencil, UserX, UserCheck, Search, Camera, Loader2 } from "lucide-react";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  avatar_url: string | null;
  created_at: string;
}

export function AdminUserListPanel() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { user: currentUser } = useAuth();
  const [confirm, confirmDialog] = useConfirm();

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await adminListUsers();
    setLoadError(error);
    if (!error && data) setUsers(data);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const openEdit = (u: UserRow) => {
    setEditUser(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
  };

  const handleSave = async () => {
    if (!editUser) return;
    setSaving(true);
    const { error } = await adminUpdateUser(editUser.id, {
      name: editName.trim(),
      email: editEmail.trim(),
      role: editRole,
    });
    if (error) toast.error("Erro: " + error);
    else {
      toast.success("Usuário atualizado");
      setEditUser(null);
      fetchUsers();
    }
    setSaving(false);
  };

  const toggleActive = async (u: UserRow) => {
    if (u.active) {
      const ok = await confirm({
        title: `Desativar ${u.name}?`,
        description: "Essa pessoa não conseguirá fazer um novo login. Se já estiver conectada, a sessão aberta pode continuar funcionando por até 7 dias. Você pode reativar depois.",
        confirmLabel: "Desativar",
        destructive: true,
      });
      if (!ok) return;
    }
    const { error } = await adminUpdateUser(u.id, { active: !u.active });
    if (error) toast.error("Erro: " + error);
    else {
      toast.success(u.active ? "Usuário desativado" : "Usuário reativado");
      fetchUsers();
    }
  };

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase())
  );

  const roleLabel: Record<string, string> = {
    admin: "Admin",
    dentista: "Dentista",
    recepcionista: "Recepcionista",
    comercial: "Comercial",
    user: "Usuário",
  };

  const roleBadgeClass: Record<string, string> = {
    admin: "bg-primary/15 text-primary border-primary/30",
    dentista: "bg-accent/50 text-accent-foreground border-accent",
    recepcionista: "bg-secondary text-secondary-foreground border-border",
    comercial: "bg-chart-4/15 text-chart-4 border-chart-4/30",
    user: "bg-muted text-muted-foreground border-border",
  };

  return (
    <>
      {confirmDialog}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Usuários Cadastrados</CardTitle>
                <CardDescription>{users.length} usuário(s) no sistema</CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
              <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, email ou função..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
          ) : loadError ? (
            <div role="alert" className="text-sm text-destructive text-center py-8 space-y-2">
              <p>Não foi possível carregar os usuários. {loadError}</p>
              <Button variant="outline" size="sm" onClick={fetchUsers}>Tentar de novo</Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum usuário encontrado</p>
          ) : (
            <div className="divide-y rounded-xl border overflow-hidden">
              {filtered.map((u) => {
                const initials = u.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div
                    key={u.id}
                    className={`flex items-center gap-3 p-3 ${!u.active ? "opacity-50" : ""}`}
                  >
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt={u.name} className="h-9 w-9 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="h-9 w-9 rounded-lg gradient-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground shrink-0">
                        {initials}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{u.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    <Badge variant="outline" className={`text-[11px] shrink-0 ${roleBadgeClass[u.role] ?? ""}`}>
                      {roleLabel[u.role] ?? u.role}
                    </Badge>
                    {!u.active && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">Inativo</Badge>
                    )}
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)} title="Editar" aria-label={`Editar ${u.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => toggleActive(u)}
                        disabled={u.id === currentUser?.id}
                        title={u.id === currentUser?.id ? "Você não pode desativar a si mesmo" : u.active ? "Desativar" : "Reativar"}
                        aria-label={u.active ? `Desativar ${u.name}` : `Reativar ${u.name}`}
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

      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Função</Label>
              <Select value={editRole} onValueChange={setEditRole} disabled={editUser?.id === currentUser?.id}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="dentista">Dentista</SelectItem>
                  <SelectItem value="recepcionista">Recepcionista</SelectItem>
                  <SelectItem value="user">Usuário (sem acesso a pacientes)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
