import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { resetPassword } from "@/lib/vpsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search) => ({
    token: (search.token as string) || "",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm shadow-card">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive text-sm">Link inválido. Solicite um novo link de recuperação.</p>
            <Link to="/login" className="text-primary text-sm hover:underline mt-4 inline-block">
              Voltar ao login
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm shadow-card">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-success mx-auto" />
            <h3 className="text-lg font-semibold text-foreground">Senha redefinida!</h3>
            <p className="text-sm text-muted-foreground">Sua senha foi alterada com sucesso.</p>
            <Link to="/login">
              <Button className="w-full">Ir para o Login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Senha deve ter no mínimo 6 caracteres");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }

    setLoading(true);
    try {
      const res = await resetPassword(token, password);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Erro ao redefinir senha");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl gradient-primary">
            <span className="text-xl font-bold text-primary-foreground">OC</span>
          </div>
          <CardTitle className="text-xl font-heading">Nova Senha</CardTitle>
          <CardDescription>Digite sua nova senha</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Nova Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repita a senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Redefinir Senha
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
