import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { saasApi } from "@/lib/saasApi";
import { useAuth } from "@/hooks/useAuth";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { TERMOS_VERSAO, POLITICA_VERSAO } from "@/lib/legal";

export const Route = createFileRoute("/signup")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { plan?: string } => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
  component: SignupPage,
});

// Nomes exibidos dos planos da landing (o slug vai para a API sem mudança)
const PLANOS: Record<string, string> = { starter: "Starter", professional: "Professional", enterprise: "Enterprise" };

function SignupPage() {
  const navigate = useNavigate();
  const { plan } = Route.useSearch();
  const { refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    clinic_name: "",
    email: "",
    password: "",
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.email || form.password.length < 8) {
      toast.error("Preencha o email e uma senha de no mínimo 8 caracteres");
      return;
    }
    if (!form.nome.trim()) {
      toast.error("Informe seu nome");
      return;
    }

    setLoading(true);
    const { error } = await saasApi.signupClinic({
      clinic_name: form.clinic_name.trim() || `Clínica ${form.nome.trim()}`,
      admin_name: form.nome.trim(),
      email: form.email,
      password: form.password,
      ...(plan ? { plan_slug: plan } : {}),
      termos_versao: TERMOS_VERSAO,
      politica_versao: POLITICA_VERSAO,
    });
    if (error) {
      setLoading(false);
      toast.error(error);
      return;
    }

    // signup-clinic já devolve o token; entra direto no sistema
    await refreshUser().catch(() => null);
    setLoading(false);
    toast.success("Clínica cadastrada! Bem-vindo ao Odonto Connect.");
    navigate({ to: "/dashboard" });
  };

  const field = "h-11";

  return (
    <AuthShell
      title="Cadastre sua clínica"
      // ⚠️ Helena: a landing promete 7 dias grátis; aqui são 14. Não decidido — ver PR.
      description={
        PLANOS[plan ?? ""]
          ? `Plano ${PLANOS[plan as string]} · 14 dias grátis, sem cartão de crédito.`
          : "14 dias grátis, sem cartão de crédito."
      }
      footer={
        <p>
          Já tem conta?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline underline-offset-4">Entrar</Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="nome">Seu nome completo</Label>
          <Input
            id="nome"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="Dr. João Silva"
            required
            autoComplete="name"
            className={field}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="clinic_name">
            Nome da clínica <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            id="clinic_name"
            value={form.clinic_name}
            onChange={(e) => setForm({ ...form, clinic_name: e.target.value })}
            placeholder="Sorriso Vital"
            autoComplete="organization"
            className={field}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="seu@email.com"
            required
            autoComplete="email"
            className={field}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Mínimo 8 caracteres"
            required
            autoComplete="new-password"
            className={field}
          />
        </div>
        <Button type="submit" disabled={loading} className="w-full h-11 text-[15px]">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Criar conta
        </Button>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Ao criar a conta, você concorda com os{" "}
          <Link to="/termos" target="_blank" className="text-primary underline underline-offset-4">Termos de Uso</Link> e a{" "}
          <Link to="/privacidade" target="_blank" className="text-primary underline underline-offset-4">Política de Privacidade</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
