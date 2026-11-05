import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { forgotPassword } from "@/lib/vpsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { Loader2, ArrowLeft, CheckCircle, Eye, EyeOff, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar · Odonto Connect" }] }),
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

  const errorBox = (msg: string, id: string) => (
    <div id={id} role="alert" className="flex gap-2 rounded-md bg-destructive/10 px-3.5 py-3 text-sm text-foreground animate-fade-in">
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
      <span>{msg}</span>
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
            {forgotError && errorBox(forgotError, "esqueci-erro")}
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
                aria-invalid={!!forgotError || undefined}
                aria-describedby={forgotError ? "esqueci-erro" : undefined}
                className="h-11"
              />
            </div>
            <Button type="submit" className="w-full h-11" disabled={forgotLoading} aria-busy={forgotLoading || undefined}>
              {forgotLoading && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {forgotLoading ? "Enviando…" : "Pedir nova senha"}
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
        {error && errorBox(error, "login-erro")}
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
            aria-invalid={!!error || undefined}
            aria-describedby={error ? "login-erro" : undefined}
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Senha</Label>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="inline-flex items-center min-h-11 -my-3 text-sm font-medium text-primary hover:underline underline-offset-4"
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
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "login-erro" : undefined}
              className="h-11 pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-0 flex items-center justify-center size-11 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" className="w-full h-11 text-callout" disabled={loading} aria-busy={loading || undefined}>
          {loading && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {loading ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </AuthShell>
  );
}
