import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/signup")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { plan?: string } => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    clinic_name: "",
    email: "",
    password: "",
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.email || form.password.length < 6) {
      toast.error("Preencha o email e uma senha de no mínimo 6 caracteres");
      return;
    }
    if (!form.nome.trim()) {
      toast.error("Informe seu nome");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          nome: form.nome,
          clinic_name: form.clinic_name || `Clínica ${form.nome}`,
        },
      },
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Conta criada! Verifique seu email para confirmar.");
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-slate-50/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-heading">Cadastre sua clínica</CardTitle>
          <CardDescription>14 dias grátis, sem cartão de crédito</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Seu nome completo</Label>
              <Input
                id="nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Dr. João Silva"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinic_name">Nome da clínica</Label>
              <Input
                id="clinic_name"
                value={form.clinic_name}
                onChange={(e) => setForm({ ...form, clinic_name: e.target.value })}
                placeholder="Sorriso Vital"
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Mínimo 6 caracteres"
                required
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full h-11 font-bold">
              {loading ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Sparkles className="h-5 w-5 mr-2" />}
              Criar conta
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Já tem conta? <Link to="/login" className="text-primary font-bold hover:underline">Entrar</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
