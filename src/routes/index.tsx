import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarCheck, Users, MessageSquare, DollarSign, Bot, ShieldCheck,
  BarChart3, Zap, CheckCircle, ArrowRight, Star, Phone, Mail,
  RefreshCcw, Brain, Flame, Clock, Target, TrendingUp,
} from "lucide-react";
import logoHorizontal from "@/assets/logo-horizontal.png";
import drLuisGustavo from "@/assets/dr-luis-gustavo.jpg";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "Odonto Connect — Sistema Completo para Clínicas Odontológicas" },
      { name: "description", content: "SaaS completo de A a Z para clínicas odontológicas. CRM, agendamento com IA, WhatsApp, financeiro e muito mais. De dono de clínica para dono." },
      { property: "og:title", content: "Odonto Connect — Sistema Completo para Clínicas Odontológicas" },
      { property: "og:description", content: "De dono de clínica para dono. Sistema completo de gestão odontológica com IA, CRM, WhatsApp e financeiro integrado." },
      { property: "og:image", content: "/images/logo-horizontal.png" },
    ],
  }),
});

const features = [
  {
    icon: RefreshCcw,
    title: "Reativação CRM Inteligente",
    desc: "Recupere pacientes inativos automaticamente com funil de follow-up inteligente. Kanban duplo de vendas e recuperação com níveis de consciência.",
    highlight: true,
  },
  {
    icon: CalendarCheck,
    title: "Agenda Clínica Completa",
    desc: "Gestão completa de consultas, encaixes, confirmações automáticas e controle de faltas. Visão por dentista, sala e procedimento.",
    highlight: true,
  },
  {
    icon: Bot,
    title: "IA Agente Autônomo",
    desc: "Inteligência artificial que realiza atendimentos e agendamentos de forma autônoma via WhatsApp. Transcrição de áudio e relatórios clínicos com IA.",
    highlight: true,
  },
  {
    icon: Flame,
    title: "Sistema Fênix WhatsApp",
    desc: "Tecnologia exclusiva de contingência que mantém sua operação ativa 24/7. Múltiplas instâncias e failover automático. Nunca fique sem WhatsApp.",
    highlight: true,
  },
  {
    icon: DollarSign,
    title: "Financeiro Integrado",
    desc: "Fluxo de caixa, contas a pagar/receber, comissões, faturamento e relatórios financeiros diretamente integrados com agendamentos e orçamentos.",
    highlight: true,
  },
  {
    icon: Users,
    title: "CRM & Funil de Vendas",
    desc: "Kanban completo com funil de vendas e recuperação. Acompanhe cada lead do primeiro contato até a conversão em paciente.",
  },
  {
    icon: MessageSquare,
    title: "Chat Multi-Atendente",
    desc: "Central de atendimento via WhatsApp com fila inteligente, atribuição automática, modo fantasma e pesquisa de satisfação.",
  },
  {
    icon: BarChart3,
    title: "Dashboard & Analytics",
    desc: "Métricas em tempo real, KPIs de atendimento, taxa de conversão, ticket médio e relatórios gerenciais completos.",
  },
  {
    icon: Target,
    title: "Disparos em Massa",
    desc: "Campanhas recorrentes ou únicas com templates, segmentação de público, controle anti-spam e métricas de entrega.",
  },
  {
    icon: Brain,
    title: "Meta Ads + IA",
    desc: "Integração com Meta Ads para análise de campanhas com insights gerados por inteligência artificial.",
  },
  {
    icon: Clock,
    title: "Prontuário Digital",
    desc: "Odontograma interativo, histórico clínico, prescrições, relatórios IA e gestão completa do paciente.",
  },
  {
    icon: TrendingUp,
    title: "Orçamentos & Tratamentos",
    desc: "Criação de orçamentos, acompanhamento de aprovação, controle de tratamentos em andamento e pagamentos.",
  },
];

const plans = [
  {
    name: "Starter",
    price: "297",
    desc: "Para clínicas iniciando a transformação digital",
    features: ["1 instância WhatsApp", "Até 500 pacientes", "CRM básico", "Agenda clínica", "Financeiro básico", "Suporte por e-mail"],
    popular: false,
  },
  {
    name: "Professional",
    price: "597",
    desc: "Para clínicas que querem crescer com inteligência",
    features: ["3 instâncias WhatsApp", "Pacientes ilimitados", "CRM completo + Reativação", "IA Agente Autônomo", "Sistema Fênix", "Financeiro completo", "Disparos em massa", "Dashboard analytics", "Suporte prioritário"],
    popular: true,
  },
  {
    name: "Enterprise",
    price: "997",
    desc: "Para redes e clínicas de alto volume",
    features: ["Instâncias ilimitadas", "Multi-unidade", "Tudo do Professional", "Meta Ads + IA Insights", "API personalizada", "Onboarding dedicado", "Gerente de conta", "SLA garantido"],
    popular: false,
  },
];

const testimonials = [
  { name: "Dra. Camila Ribeiro", clinic: "Sorriso Perfeito", text: "Recuperamos 34% dos pacientes inativos no primeiro mês. O CRM de reativação é incrível!", stars: 5 },
  { name: "Dr. Marcos Oliveira", clinic: "OdontoLife", text: "A IA agente mudou completamente nosso atendimento. Agendamentos 24h sem precisar de recepcionista.", stars: 5 },
  { name: "Dra. Juliana Santos", clinic: "Dental Premium", text: "O sistema Fênix nos salvou várias vezes. Nunca mais ficamos sem WhatsApp.", stars: 5 },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <img src={logoHorizontal} alt="Odonto Connect" className="h-8" />
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#funcionalidades" className="hover:text-foreground transition-colors">Funcionalidades</a>
            <a href="#sobre" className="hover:text-foreground transition-colors">Sobre</a>
            <a href="#planos" className="hover:text-foreground transition-colors">Planos</a>
            <a href="#depoimentos" className="hover:text-foreground transition-colors">Depoimentos</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-foreground hover:text-primary transition-colors">
              Entrar
            </Link>
            <a href="#planos" className="inline-flex items-center gap-1.5 rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow-primary hover:opacity-90 transition-opacity">
              Começar Agora <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/40 via-background to-background" />
        <div className="max-w-7xl mx-auto relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-foreground">
                <Zap className="h-3.5 w-3.5" /> De dono de clínica para dono
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold text-foreground leading-tight">
                O sistema <span className="gradient-text">completo de A a Z</span> para clínicas odontológicas
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl leading-relaxed">
                CRM inteligente, agendamento com IA autônoma, WhatsApp com contingência Fênix, financeiro integrado e muito mais. 
                Tudo que sua clínica precisa em uma única plataforma.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <a href="#planos" className="inline-flex items-center justify-center gap-2 rounded-xl gradient-primary px-8 py-3.5 text-base font-bold text-primary-foreground shadow-glow-primary hover:opacity-90 transition-opacity">
                  Quero Conhecer <ArrowRight className="h-5 w-5" />
                </a>
                <a href="https://wa.me/5511999990001" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-8 py-3.5 text-base font-semibold text-foreground hover:bg-accent transition-colors">
                  <Phone className="h-5 w-5 text-primary" /> Falar com Consultor
                </a>
              </div>
              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-success" /> 7 dias grátis</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-success" /> Sem fidelidade</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-success" /> Suporte humano</span>
              </div>
            </div>
            <div className="relative hidden lg:block">
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/20 via-dental-cyan/10 to-transparent blur-3xl" />
              <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-border">
                <div className="bg-card p-8 space-y-4">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="h-3 w-3 rounded-full bg-destructive/60" />
                    <div className="h-3 w-3 rounded-full bg-warning/60" />
                    <div className="h-3 w-3 rounded-full bg-success/60" />
                    <span className="ml-2 text-xs text-muted-foreground">Odonto Connect — Dashboard</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Consultas Hoje", val: "24", color: "text-primary" },
                      { label: "Taxa Presença", val: "94%", color: "text-success" },
                      { label: "Reativados", val: "18", color: "text-info" },
                    ].map((k) => (
                      <div key={k.label} className="rounded-xl bg-accent/50 p-3 text-center">
                        <p className={`text-2xl font-bold ${k.color}`}>{k.val}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{k.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {["Maria Silva — Implante — 09:00", "João Santos — Clareamento — 10:30", "Ana Costa — Retorno — 14:00"].map((item) => (
                      <div key={item} className="flex items-center gap-3 rounded-lg bg-accent/30 px-3 py-2 text-xs text-foreground">
                        <CalendarCheck className="h-3.5 w-3.5 text-primary" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="funcionalidades" className="py-24 px-4 sm:px-6 lg:px-8 bg-card/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">
              Tudo que sua clínica precisa, <span className="gradient-text">em um só lugar</span>
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Sistema completo desenvolvido por quem entende a rotina de uma clínica odontológica.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className={`group rounded-2xl p-6 transition-all hover-lift ${
                  f.highlight
                    ? "bg-card border-2 border-primary/20 shadow-glow-primary"
                    : "bg-card border border-border shadow-card"
                }`}
              >
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center mb-4 ${
                  f.highlight ? "gradient-primary text-primary-foreground" : "bg-accent text-accent-foreground"
                }`}>
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-heading font-bold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                {f.highlight && (
                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    <Star className="h-3 w-3 fill-primary" /> Destaque
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About / Dr. Luis Gustavo */}
      <section id="sobre" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="relative">
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/10 to-dental-cyan/10 blur-2xl" />
              <img
                src={drLuisGustavo}
                alt="Dr. Luis Gustavo — Fundador do Odonto Connect"
                className="relative rounded-2xl shadow-2xl w-full max-w-md mx-auto object-cover aspect-square"
              />
            </div>
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> De dono de clínica para dono
              </div>
              <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground leading-tight">
                Criado por quem <span className="gradient-text">vive a odontologia</span> todos os dias
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                O Odonto Connect nasceu da experiência real do <strong className="text-foreground">Dr. Luis Gustavo</strong>, 
                implantodontista e dono de clínica há mais de 15 anos. Cansado de sistemas genéricos que não entendiam 
                a rotina de uma clínica odontológica, ele decidiu criar a solução que sempre quis ter.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Cada funcionalidade foi desenhada pensando nos problemas reais: pacientes que somem, 
                WhatsApp que cai, agenda desorganizada, financeiro manual. O resultado é um sistema que 
                realmente funciona porque foi feito por quem entende.
              </p>
              <div className="grid grid-cols-3 gap-4 pt-4">
                {[
                  { val: "15+", label: "Anos de experiência" },
                  { val: "500+", label: "Clínicas atendidas" },
                  { val: "98%", label: "Satisfação" },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <p className="text-2xl font-heading font-bold gradient-text">{s.val}</p>
                    <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="planos" className="py-24 px-4 sm:px-6 lg:px-8 bg-card/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">
              Planos que <span className="gradient-text">cabem no seu bolso</span>
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Comece gratuitamente por 7 dias. Sem compromisso, sem cartão de crédito.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-8 flex flex-col ${
                  plan.popular
                    ? "bg-card border-2 border-primary shadow-glow-primary scale-105"
                    : "bg-card border border-border shadow-card"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full gradient-primary px-4 py-1 text-xs font-bold text-primary-foreground">
                    Mais Popular
                  </div>
                )}
                <h3 className="text-xl font-heading font-bold text-foreground">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{plan.desc}</p>
                <div className="mt-6 mb-8">
                  <span className="text-4xl font-heading font-bold text-foreground">R$ {plan.price}</span>
                  <span className="text-muted-foreground text-sm">/mês</span>
                </div>
                <ul className="space-y-3 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                      <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <a
                  href="https://wa.me/5511999990001"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`mt-8 w-full inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition-all ${
                    plan.popular
                      ? "gradient-primary text-primary-foreground shadow-glow-primary hover:opacity-90"
                      : "border border-border bg-accent text-foreground hover:bg-primary hover:text-primary-foreground"
                  }`}
                >
                  Começar Agora <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="depoimentos" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">
              Quem usa, <span className="gradient-text">recomenda</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((t) => (
              <div key={t.name} className="rounded-2xl bg-card border border-border p-6 shadow-card">
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: t.stars }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-warning text-warning" />
                  ))}
                </div>
                <p className="text-sm text-foreground leading-relaxed mb-4">"{t.text}"</p>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.clinic}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center rounded-3xl gradient-primary p-12 sm:p-16 shadow-glow-primary relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary-glow/20 to-transparent" />
          <div className="relative space-y-6">
            <h2 className="text-3xl sm:text-4xl font-heading font-bold text-primary-foreground">
              Pronto para transformar sua clínica?
            </h2>
            <p className="text-primary-foreground/80 text-lg max-w-2xl mx-auto">
              Junte-se a centenas de clínicas que já estão crescendo com o Odonto Connect. 
              Comece seu teste gratuito de 7 dias agora.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="https://wa.me/5511999990001"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-card text-foreground px-8 py-3.5 text-base font-bold hover:bg-card/90 transition-colors"
              >
                Começar Agora Grátis <ArrowRight className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12 px-4 sm:px-6 lg:px-8 bg-card">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="space-y-4">
              <img src={logoHorizontal} alt="Odonto Connect" className="h-7" />
              <p className="text-sm text-muted-foreground">
                Sistema completo de A a Z para clínicas odontológicas. De dono de clínica para dono.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-4 text-sm">Produto</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#funcionalidades" className="hover:text-foreground transition-colors">Funcionalidades</a></li>
                <li><a href="#planos" className="hover:text-foreground transition-colors">Planos</a></li>
                <li><a href="#depoimentos" className="hover:text-foreground transition-colors">Depoimentos</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-4 text-sm">Suporte</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="https://wa.me/5511999990001" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> WhatsApp</a></li>
                <li><a href="mailto:contato@odontoconnect.com" className="hover:text-foreground transition-colors flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> E-mail</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-foreground mb-4 text-sm">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Termos de Uso</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Privacidade</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-border text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} Odonto Connect. Todos os direitos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
