import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { saasApi, type Plan } from "@/lib/saasApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, Loader2, Sparkles, ChevronRight, ChevronLeft, User, Building2, Lock, CreditCard } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/signup")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { plan?: string } => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
  component: SignupPage,
});

const STEPS = [
  { title: "Plano", icon: CreditCard, description: "Escolha seu plano" },
  { title: "Pessoal", icon: User, description: "Sobre você" },
  { title: "Clínica", icon: Building2, description: "Sua clínica" },
  { title: "Acesso", icon: Lock, description: "Dados de login" },
];

function SignupPage() {
  const navigate = useNavigate();
  const { plan: planFromUrl } = Route.useSearch();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string>(planFromUrl || "starter");
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  
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
      if (data.length && !data.find((p) => p.slug === selectedPlan)) {
        setSelectedPlan(data[0].slug);
      }
    });
  }, []);

  const nextStep = () => {
    if (currentStep === 1 && (!form.admin_name || !form.telefone)) {
      toast.error("Por favor, preencha seu nome e telefone");
      return;
    }
    if (currentStep === 2 && !form.clinic_name) {
      toast.error("Por favor, informe o nome da clínica");
      return;
    }
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || form.password.length < 6) {
      toast.error("Preencha o email e uma senha de no mínimo 6 caracteres");
      return;
    }
    
    setLoading(true);
    const res = await saasApi.signupClinic({ ...form, plan_slug: selectedPlan });
    setLoading(false);
    
    if (res.error) {
      toast.error(res.error);
      return;
    }
    
    toast.success("Conta criada! Trial iniciado.");
    navigate({ to: "/dashboard" });
  };

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-slate-50/50 flex flex-col items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-[600px] space-y-8">
        {/* Header Section */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/10 mb-4">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Odonto Connect Hub</h1>
          <p className="text-muted-foreground">Tudo o que sua clínica precisa em um só lugar</p>
        </div>

        {/* Progress Indicator */}
        <div className="space-y-4">
          <div className="flex justify-between items-center px-2">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = idx === currentStep;
              const isCompleted = idx < currentStep;
              
              return (
                <div key={idx} className="flex flex-col items-center gap-2">
                  <div 
                    className={`h-10 w-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                      isActive ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-110" : 
                      isCompleted ? "border-primary bg-primary/10 text-primary" : 
                      "border-muted bg-background text-muted-foreground"
                    }`}
                  >
                    {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <span className={`text-[10px] uppercase font-bold tracking-wider transition-colors duration-300 ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <Card className="border-none shadow-xl shadow-slate-200/50 overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle>{STEPS[currentStep].title}</CardTitle>
            <CardDescription>{STEPS[currentStep].description}</CardDescription>
          </CardHeader>
          <CardContent>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* STEP 0: PLAN SELECTION */}
                {currentStep === 0 && (
                  <div className="grid gap-3">
                    {plans.map((p) => {
                      const active = selectedPlan === p.slug;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedPlan(p.slug)}
                          className={`w-full text-left rounded-xl border p-4 transition-all duration-300 relative overflow-hidden ${
                            active 
                              ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm" 
                              : "border-slate-200 hover:border-primary/40 bg-background"
                          }`}
                        >
                          <div className="flex items-start justify-between relative z-10">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`font-bold ${active ? "text-primary" : "text-slate-900"}`}>{p.nome}</span>
                                {active && (
                                  <span className="bg-primary text-[10px] text-primary-foreground px-2 py-0.5 rounded-full uppercase font-bold tracking-tight">
                                    Selecionado
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed max-w-[280px]">{p.descricao}</p>
                            </div>
                            <div className="text-right">
                              <div className={`text-xl font-black ${active ? "text-primary" : "text-slate-900"}`}>
                                R$ {Number(p.preco_mensal).toFixed(0)}
                              </div>
                              <div className="text-[10px] text-muted-foreground uppercase font-bold">por mês</div>
                            </div>
                          </div>
                          
                          <div className="mt-4 flex flex-wrap gap-2 relative z-10">
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600">
                              <Check className="h-3 w-3" /> {p.max_usuarios ? `${p.max_usuarios} Usuários` : "Usuários Ilimitados"}
                            </div>
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600">
                              <Check className="h-3 w-3" /> {p.max_dentistas ? `${p.max_dentistas} Dentistas` : "Dentistas Ilimitados"}
                            </div>
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 text-[10px] font-bold text-primary">
                              <Sparkles className="h-3 w-3" /> {p.trial_days} Dias Grátis
                            </div>
                          </div>

                          {active && (
                            <motion.div 
                              layoutId="active-plan-bg"
                              className="absolute inset-0 bg-primary/5 -z-0"
                              initial={false}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* STEP 1: PERSONAL INFO */}
                {currentStep === 1 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="admin_name">Seu nome completo</Label>
                      <Input 
                        id="admin_name"
                        value={form.admin_name} 
                        onChange={(e) => setForm({ ...form, admin_name: e.target.value })} 
                        placeholder="Ex: Dr. Silva Sauro"
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="telefone">WhatsApp / Telefone</Label>
                      <Input 
                        id="telefone"
                        value={form.telefone} 
                        onChange={(e) => setForm({ ...form, telefone: e.target.value })} 
                        placeholder="(11) 99999-9999"
                        className="h-11"
                      />
                    </div>
                  </div>
                )}

                {/* STEP 2: CLINIC INFO */}
                {currentStep === 2 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="clinic_name">Nome da clínica</Label>
                      <Input 
                        id="clinic_name"
                        value={form.clinic_name} 
                        onChange={(e) => setForm({ ...form, clinic_name: e.target.value })} 
                        placeholder="Ex: Sorriso Vital"
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label htmlFor="cnpj">CNPJ</Label>
                        <span className="text-[10px] text-muted-foreground uppercase font-bold">Opcional</span>
                      </div>
                      <Input 
                        id="cnpj"
                        value={form.cnpj} 
                        onChange={(e) => setForm({ ...form, cnpj: e.target.value })} 
                        placeholder="00.000.000/0000-00"
                        className="h-11"
                      />
                    </div>
                  </div>
                )}

                {/* STEP 3: ACCESS INFO */}
                {currentStep === 3 && (
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">E-mail profissional</Label>
                      <Input 
                        id="email"
                        type="email" 
                        value={form.email} 
                        onChange={(e) => setForm({ ...form, email: e.target.value })} 
                        placeholder="seu@email.com"
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Crie uma senha segura</Label>
                      <Input 
                        id="password"
                        type="password" 
                        value={form.password} 
                        onChange={(e) => setForm({ ...form, password: e.target.value })} 
                        placeholder="Mínimo 6 caracteres"
                        className="h-11"
                      />
                    </div>
                    <div className="pt-2">
                      <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                        Ao finalizar, você concorda com nossos <Link to="/" className="text-primary hover:underline">Termos de Uso</Link> e <Link to="/" className="text-primary hover:underline">Política de Privacidade</Link>.
                      </p>
                    </div>
                  </form>
                )}

                {/* NAVIGATION BUTTONS */}
                <div className="flex gap-3 pt-4">
                  {currentStep > 0 && (
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={prevStep}
                      className="flex-1 h-12 font-bold"
                    >
                      <ChevronLeft className="h-4 w-4 mr-2" />
                      Voltar
                    </Button>
                  )}
                  
                  {currentStep < STEPS.length - 1 ? (
                    <Button 
                      type="button" 
                      onClick={nextStep}
                      className="flex-[2] h-12 font-bold"
                    >
                      Continuar
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  ) : (
                    <Button 
                      onClick={submit} 
                      disabled={loading} 
                      className="flex-[2] h-12 font-bold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
                    >
                      {loading ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Sparkles className="h-5 w-5 mr-2" />}
                      Finalizar e Iniciar Teste
                    </Button>
                  )}
                </div>

                <div className="text-center pt-2">
                  <p className="text-xs text-muted-foreground">
                    Já possui uma conta? <Link to="/login" className="text-primary font-bold hover:underline">Entrar agora</Link>
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
