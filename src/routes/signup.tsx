import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { saasApi, type Plan } from "@/lib/saasApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/signup")({
  ssr: false,
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<string>("starter");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    clinic_name: "",
    admin_name: "",
    email: "",
    password: "",
    telefone: "",
    cnpj: "",
  });

  useEffect(() => {
    saasApi.listPlans().then((r) => {
      const data = r.data?.data ?? [];
      setPlans(data);
      if (data.length && !data.find((p) => p.slug === selected)) {
        setSelected(data[0].slug);
      }
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clinic_name || !form.admin_name || !form.email || form.password.length < 6) {
      toast.error("Preencha todos os campos (senha mínima 6 caracteres)");
      return;
    }
    setLoading(true);
    const res = await saasApi.signupClinic({ ...form, plan_slug: selected });
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Conta criada! Trial iniciado.");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1fr_1fr] gap-6">
        {/* Form */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Crie sua conta</CardTitle>
                <CardDescription>Teste grátis por 14 dias. Sem cartão.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome da clínica</Label>
                <Input value={form.clinic_name} onChange={(e) => setForm({ ...form, clinic_name: e.target.value })} placeholder="Clínica OdontoVida" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Seu nome</Label>
                  <Input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="(11) 99999-9999" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Senha</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mín. 6 caracteres" />
              </div>
              <div className="space-y-2">
                <Label>CNPJ (opcional)</Label>
                <Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Iniciar teste grátis
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Já tem conta? <Link to="/login" className="text-primary hover:underline">Entrar</Link>
              </p>
            </form>
          </CardContent>
        </Card>

        {/* Plans */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Escolha um plano</h3>
          {plans.map((p) => {
            const active = selected === p.slug;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p.slug)}
                className={`w-full text-left rounded-xl border p-4 transition ${
                  active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{p.nome}</span>
                      {active && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.descricao}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-foreground">
                      R$ {Number(p.preco_mensal).toFixed(0)}
                    </div>
                    <div className="text-xs text-muted-foreground">/ mês</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  <span className="px-2 py-0.5 rounded bg-muted">
                    {p.max_usuarios ? `${p.max_usuarios} usuários` : "Usuários ilimitados"}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-muted">
                    {p.max_dentistas ? `${p.max_dentistas} dentistas` : "Dentistas ilimitados"}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-muted">
                    {p.trial_days} dias grátis
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
