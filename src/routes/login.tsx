import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { forgotPassword } from "@/lib/vpsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { Loader2, ArrowLeft, CheckCircle, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { login, isAuthenticated, user } = useAuth();
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

  useEffect(() => {
    if (isAuthenticated && user) {
      if (user.is_super_admin) navigate({ to: "/super-admin" });
      else navigate({ to: "/dashboard" });
    }
  }, [isAuthenticated, user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
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
      // A VPS registra o pedido; o admin da clínica redefine a senha no painel.
      const { error: err } = await forgotPassword(forgotEmail);
      if (err) setForgotError(err);
      else setForgotSent(true);
    } catch {
      setForgotError("Erro ao enviar solicitação");
    } finally {
      setForgotLoading(false);
    }
  };

  if (isAuthenticated) return null;

  const errorBox = (msg: string) => (
    <div role="alert" className="rounded-md bg-destructive/10 px-3.5 py-3 text-sm text-destructive animate-fade-in">
      {msg}
    </div>
  );

  if (showForgot) {
    return (
      <AuthShell
        title={forgotSent ? "Pedido enviado" : "Recuperar acesso"}
        description={
          forgotSent
            ? undefined
            : "Informe o e-mail da sua conta. O administrador da clínica recebe o pedido e redefine sua senha."
        }
      >
        {forgotSent ? (
          <div className="space-y-6">
            <div className="flex gap-3 rounded-md bg-success/10 px-4 py-3.5">
              <CheckCircle className="h-5 w-5 text-success shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-foreground leading-relaxed">
                O administrador da clínica vai redefinir sua senha e falar com você.
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={() => { setShowForgot(false); setForgotSent(false); }}
            >
              <ArrowLeft className="h-4 w-4" /> Voltar ao login
            </Button>
          </div>
        ) : (
          <form onSubmit={handleForgot} className="space-y-5">
            {forgotError && errorBox(forgotError)}
            <div className="space-y-2">
              <Label htmlFor="forgot-email">E-mail</Label>
              <Input
                id="forgot-email"
                type="email"
                placeholder="seu@email.com"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-11"
              />
            </div>
            <Button type="submit" className="w-full h-11" disabled={forgotLoading}>
              {forgotLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Pedir nova senha
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full h-11"
              onClick={() => setShowForgot(false)}
            >
              <ArrowLeft className="h-4 w-4" /> Voltar ao login
            </Button>
          </form>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Entrar no Odonto Connect"
      description="Acesse a agenda e os pacientes da sua clínica."
      footer={
        <p>
          Ainda não usa o Odonto Connect?{" "}
          <Link to="/signup" search={{}} className="font-medium text-primary hover:underline underline-offset-4">
            Cadastre sua clínica
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && errorBox(error)}
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Senha</Label>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-[13px] font-medium text-primary hover:underline underline-offset-4"
            >
              Esqueci minha senha
            </button>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="h-11 pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center h-9 w-9 rounded text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" className="w-full h-11 text-[15px]" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Entrar
        </Button>
      </form>
    </AuthShell>
  );
}
