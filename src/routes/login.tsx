import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { forgotPassword } from "@/lib/vpsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, CheckCircle, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState("");

  // Redirect if already authenticated (useEffect instead of conditional return before hooks)
  useEffect(() => {
    if (isAuthenticated) {
      navigate({ to: "/" });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao fazer login");
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    try {
      const res = await forgotPassword(forgotEmail);
      if (res.error) {
        setForgotError(res.error);
      } else {
        setForgotSent(true);
      }
    } catch {
      setForgotError("Erro ao enviar email");
    } finally {
      setForgotLoading(false);
    }
  };

  if (isAuthenticated) return null;

  if (showForgot) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm shadow-card animate-fade-in">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl gradient-primary">
              <span className="text-xl font-bold text-primary-foreground">OC</span>
            </div>
            <CardTitle className="text-xl font-heading">Recuperar Senha</CardTitle>
            <CardDescription>
              {forgotSent
                ? "Verifique seu email"
                : "Informe seu email para receber o link de recuperação"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {forgotSent ? (
              <div className="text-center space-y-4">
                <CheckCircle className="h-12 w-12 text-success mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Sua solicitação foi enviada ao administrador. Ele redefinirá sua senha e entrará em contato.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => { setShowForgot(false); setForgotSent(false); }}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao Login
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="space-y-4">
                {forgotError && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive animate-fade-in">
                    {forgotError}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">Email</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={forgotLoading}>
                  {forgotLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Enviar Link de Recuperação
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setShowForgot(false)}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao Login
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-card animate-fade-in">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl gradient-primary">
            <span className="text-xl font-bold text-primary-foreground">OC</span>
          </div>
          <CardTitle className="text-xl font-heading">Odonto Connect</CardTitle>
          <CardDescription>Faça login para acessar o sistema</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive animate-fade-in">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@odontoconnect.tech"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Esqueci minha senha
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
