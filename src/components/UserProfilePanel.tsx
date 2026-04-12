import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { profileApi } from "@/lib/vpsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Camera, User, Mail, Lock, Loader2, Save } from "lucide-react";

export function UserProfilePanel() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar_url ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = (user?.name ?? "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem deve ter no máximo 5MB");
      return;
    }

    // Preview
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);

    setUploadingAvatar(true);
    const { data, error } = await profileApi.uploadAvatar(file);
    if (error) {
      toast.error("Erro ao enviar foto: " + error);
    } else if (data) {
      setAvatarPreview(data.avatar_url);
      toast.success("Foto atualizada!");
      // Reload to update header
      setTimeout(() => window.location.reload(), 1000);
    }
    setUploadingAvatar(false);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Nome não pode ser vazio");
      return;
    }
    setSavingProfile(true);
    const { error } = await profileApi.update({ name: name.trim(), email: email.trim() });
    if (error) toast.error("Erro: " + error);
    else {
      toast.success("Perfil atualizado!");
      setTimeout(() => window.location.reload(), 1000);
    }
    setSavingProfile(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error("Preencha todos os campos de senha");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Nova senha deve ter pelo menos 6 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }
    setSavingPassword(true);
    const { error } = await profileApi.changePassword(currentPassword, newPassword);
    if (error) toast.error("Erro: " + error);
    else {
      toast.success("Senha alterada com sucesso!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setSavingPassword(false);
  };

  return (
    <div className="space-y-6">
      {/* Avatar + Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Meu Perfil</CardTitle>
              <CardDescription>Edite suas informações pessoais</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-5">
            <div className="relative group">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="Avatar"
                  className="h-20 w-20 rounded-2xl object-cover border-2 border-border"
                />
              ) : (
                <div className="h-20 w-20 rounded-2xl bg-primary/15 flex items-center justify-center text-xl font-bold text-primary border-2 border-border">
                  {initials}
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                {uploadingAvatar ? (
                  <Loader2 className="h-5 w-5 text-white animate-spin" />
                ) : (
                  <Camera className="h-5 w-5 text-white" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              <p className="text-xs text-muted-foreground capitalize mt-0.5">{user?.role}</p>
            </div>
          </div>

          {/* Profile form */}
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="profile-name">
                  <User className="h-3.5 w-3.5 inline mr-1.5" />
                  Nome completo
                </Label>
                <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-email">
                  <Mail className="h-3.5 w-3.5 inline mr-1.5" />
                  Email
                </Label>
                <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={savingProfile} size="sm">
              <Save className="h-4 w-4 mr-1.5" />
              {savingProfile ? "Salvando..." : "Salvar Perfil"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <Lock className="h-5 w-5 text-warning" />
            </div>
            <div>
              <CardTitle className="text-lg">Alterar Senha</CardTitle>
              <CardDescription>Atualize sua senha de acesso</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Senha atual</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Digite sua senha atual"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova senha</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mín. 6 caracteres"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar nova senha</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita a nova senha"
                />
              </div>
            </div>
            <Button type="submit" disabled={savingPassword} variant="outline" size="sm">
              <Lock className="h-4 w-4 mr-1.5" />
              {savingPassword ? "Alterando..." : "Alterar Senha"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
