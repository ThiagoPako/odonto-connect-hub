import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarCheck, Users, MessageSquare, DollarSign, Bot,
  BarChart3, CheckCircle, ArrowRight, Star, Phone, Mail,
  RefreshCcw, Brain, Clock, Target, TrendingUp, Plus,
} from "lucide-react";
import logoHorizontal from "@/assets/logo-horizontal.png";
import drLuisGustavo from "@/assets/dr-luis-gustavo.jpg";
import { ScrollReveal } from "@/components/ScrollReveal";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { AgendaFragment } from "@/components/marketing/AgendaFragment";
import { useForceLightTheme } from "@/hooks/useForceLightTheme";
import { textoTesteGratis, useTesteGratisDias, usePlanosPublicos, WHATSAPP_CONSULTOR, EMAIL_CONTATO } from "@/lib/oferta";
import type { PublicPlan as Plan } from "@/lib/saasApi";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "Odonto Connect — Sistema Completo para Clínicas Odontológicas" },
      { name: "description", content: "Sistema de gestão para clínicas odontológicas: CRM, agenda, WhatsApp, prontuário e financeiro. De dono de clínica para dono." },
      { property: "og:title", content: "Odonto Connect — Sistema Completo para Clínicas Odontológicas" },
      { property: "og:description", content: "De dono de clínica para dono. Gestão odontológica com CRM, agenda, WhatsApp, prontuário e financeiro." },
      { property: "og:image", content: "/images/logo-horizontal.png" },
    ],
  }),
});

/**
 * ⚠️ PROVA SOCIAL EM ESPERA (revisão da Helena — CDC art. 37 e regras do CFO sobre publicidade).
 * Depoimentos, a faixa "Quem confia" (clínicas com emoji), "500+ clínicas", "98% satisfação" e
 * "centenas de clínicas" não têm fonte no repositório. Ficam guardados aqui e só aparecem quando
 * alguém confirmar que são reais e autorizados. Os textos originais estão intactos abaixo.
 */
const PROVA_SOCIAL_CONFIRMADA = false;

/**
 * Textos de venda revisados pela Helena (docs/juridico/revisao-prs-lote-1.md, PR #19): cada
 * frase descreve o que o sistema faz hoje (CDC arts. 30, 31 e 37). Recurso novo só entra aqui
 * depois de existir no produto.
 */

const features = [
  { icon: RefreshCcw, title: "Reativação CRM Inteligente", desc: "Recupere pacientes inativos automaticamente com funil de follow-up inteligente. Kanban duplo de vendas e recuperação com níveis de consciência.", highlight: true },
  { icon: CalendarCheck, title: "Agenda Clínica Completa", desc: "Gestão completa de consultas, encaixes, confirmações automáticas e controle de faltas. Visão por dentista, sala e procedimento.", highlight: true },
  { icon: MessageSquare, title: "WhatsApp da clínica", desc: "Conversas da recepção em um só lugar, com fila de envio que respeita horário, ritmo e pedidos de SAIR.", highlight: true },
  { icon: DollarSign, title: "Financeiro Integrado", desc: "Fluxo de caixa, contas a pagar/receber, comissões, faturamento e relatórios financeiros diretamente integrados com agendamentos e orçamentos.", highlight: true },
  { icon: Users, title: "CRM & Funil de Vendas", desc: "Kanban completo com funil de vendas e recuperação. Acompanhe cada lead do primeiro contato até a conversão em paciente." },
  { icon: MessageSquare, title: "Chat Multi-Atendente", desc: "Central de atendimento via WhatsApp com fila, atribuição de conversas, supervisão de conversas pelo gestor e pesquisa de satisfação." },
  { icon: Bot, title: "Relatórios clínicos com IA", desc: "Transcrição da consulta, com autorização do paciente, e relatório revisado pelo dentista." },
  { icon: BarChart3, title: "Painel do dia", desc: "Painel com a agenda e os atendimentos do dia." },
  { icon: Target, title: "Disparos em Massa", desc: "Campanhas recorrentes ou únicas com templates, segmentação de público, controle anti-spam e métricas de entrega." },
  { icon: Brain, title: "Meta Ads + IA", desc: "Integração com Meta Ads para análise de campanhas com insights gerados por inteligência artificial." },
  { icon: Clock, title: "Prontuário Digital", desc: "Odontograma interativo, histórico clínico, prescrições, relatórios IA e gestão completa do paciente." },
  { icon: TrendingUp, title: "Orçamentos & Tratamentos", desc: "Criação de orçamentos, acompanhamento de aprovação, controle de tratamentos em andamento e pagamentos." },
];

/**
 * Planos: nome, descrição e limites vêm de `GET /api/plans` (tabela `plans`, só ativos).
 * A lista abaixo é só o fallback (API fora do ar). Preço NÃO aparece na landing (decisão
 * jurídica; o valor final é do dono) — só no cadastro e em Minha assinatura, lidos da mesma API.
 */
const plans = [
  { slug: "starter", name: "Starter", desc: "Para clínicas pequenas começando agora", features: ["1 número de WhatsApp", "Até 3 usuários e 2 dentistas", "Até 500 pacientes", "CRM e agenda clínica", "Financeiro", "Suporte por e-mail"], popular: false },
  { slug: "pro", name: "Profissional", desc: "Para clínicas em crescimento", features: ["3 números de WhatsApp", "Até 10 usuários e 8 dentistas", "Até 5.000 pacientes", "CRM com reativação de pacientes", "Disparos com fila e opção de SAIR", "Integração Clinicorp", "Meta Ads"], popular: true },
  { slug: "enterprise", name: "Enterprise", desc: "Para grandes clínicas e redes", features: ["Tudo do Profissional", "Sem limite de usuários, dentistas e pacientes", "Sem limite de números de WhatsApp", "Relatórios clínicos com IA"], popular: false },
];

const testimonials = [
  { name: "Dra. Camila Ribeiro", clinic: "Sorriso Perfeito", text: "Recuperamos 34% dos pacientes inativos no primeiro mês. O CRM de reativação é incrível!", stars: 5 },
  { name: "Dr. Marcos Oliveira", clinic: "OdontoLife", text: "A IA agente mudou completamente nosso atendimento. Agendamentos 24h sem precisar de recepcionista.", stars: 5 },
  { name: "Dra. Juliana Santos", clinic: "Dental Premium", text: "O sistema Fênix nos salvou várias vezes. Nunca mais ficamos sem WhatsApp.", stars: 5 },
];

// Prazo do teste vem de plans.trial_days (GET /api/plans), com fallback em oferta.ts.
const faqsCom = (diasTeste: number) => [
  { q: "Preciso instalar algum software no computador?", a: "Não! O Odonto Connect é 100% online (SaaS). Funciona no navegador, sem instalar nada." },
  { q: "Como funciona a reativação de pacientes pelo CRM?", a: "O CRM possui um funil de recuperação com follow-ups automáticos. Pacientes inativos ou que não responderam entram em uma sequência inteligente de contato via WhatsApp, para trazer de volta quem não voltou." },
  { q: "Posso migrar meus dados de outro sistema?", a: "Sim. Nossa equipe ajuda a trazer seus dados e confere tudo com você." },
  { q: "Quantas pessoas podem usar o sistema ao mesmo tempo?", a: "Cada plano tem um número de usuários; toda a equipe pode acessar ao mesmo tempo, com permissões por função." },
  { q: "O sistema emite relatórios financeiros?", a: "Sim! O módulo financeiro integrado gera relatórios de faturamento, fluxo de caixa, contas a pagar/receber, comissões por dentista e muito mais." },
  { q: "Existe período de teste gratuito?", a: `Sim! Você testa por ${diasTeste} dias, sem cartão de crédito. Nada é cobrado sem a sua aprovação.` },
];

/* Medidas da página: uma margem, uma largura, um raio. Ver DESIGN.md › Landing. */
const WRAP = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-12";
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 h-12 px-6 rounded-md bg-primary text-primary-foreground text-[0.9375rem] font-semibold hover:bg-primary/90 active:translate-y-px transition-[background-color,transform]";
const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-2 h-12 px-6 rounded-md bg-secondary text-foreground text-[0.9375rem] font-semibold hover:bg-border active:translate-y-px transition-[background-color,transform]";

function LandingPage() {
  useForceLightTheme();
  return (
    <div className="min-h-dvh bg-background text-foreground text-base">
      <SiteNav />
      <main>
        <Hero />
        {PROVA_SOCIAL_CONFIRMADA && <TrustedBy />}
        <Features />
        <About />
        <Pricing />
        {PROVA_SOCIAL_CONFIRMADA && <Testimonials />}
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ─── Navegação ──────────────────────────────────────────── */

function SiteNav() {
  // Borda só depois que o conteúdo começa a passar por baixo (separa camadas sem pesar no topo)
  const [rolou, setRolou] = useState(false);
  useEffect(() => {
    const onScroll = () => setRolou(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`sticky top-0 z-50 surface-glass border-b transition-colors ${rolou ? "border-border" : "border-transparent"}`}>
      <nav className={`${WRAP} h-16 flex items-center justify-between gap-3 sm:gap-4`} aria-label="Principal">
        {/* No celular o logo encolhe para caber com os dois botões (a 375 px passava 8 px da tela) */}
        <Link to="/" className="min-w-0 shrink" aria-label="Odonto Connect — início">
          <img src={logoHorizontal} alt="Odonto Connect" className="block w-full max-w-[198px] h-auto sm:max-w-none sm:w-auto sm:h-7" width={1920} height={194} />
        </Link>
        <div className="hidden lg:flex items-center gap-8 text-[0.9375rem] font-medium text-muted-foreground">
          <a href="#funcionalidades" className="hover:text-foreground transition-colors">Funcionalidades</a>
          <a href="#sobre" className="hover:text-foreground transition-colors">Quem criou</a>
          <a href="#planos" className="hover:text-foreground transition-colors">Planos</a>
          {PROVA_SOCIAL_CONFIRMADA && <a href="#depoimentos" className="hover:text-foreground transition-colors">Depoimentos</a>}
          <a href="#faq" className="hover:text-foreground transition-colors">Dúvidas</a>
        </div>
        <div className="flex items-center gap-1 sm:gap-3 shrink-0">
          <Link to="/login" className="inline-flex items-center h-11 sm:h-10 px-3 rounded-md text-[0.9375rem] font-medium text-foreground hover:bg-secondary transition-colors">
            Entrar
          </Link>
          <Link to="/signup" search={{}} className="inline-flex items-center gap-1.5 h-11 sm:h-10 px-4 rounded-md bg-primary text-primary-foreground text-[0.9375rem] font-semibold hover:bg-primary/90 transition-colors">
            <span className="sm:hidden">Testar</span>
            <span className="hidden sm:inline">Começar agora</span>
          </Link>
        </div>
      </nav>
    </header>
  );
}

/* ─── Hero: o produto trabalhando ────────────────────────── */

function Hero() {
  const diasTeste = useTesteGratisDias();
  return (
    <section className="pt-10 pb-16 sm:pt-16 lg:pt-20 lg:pb-24">
      <div className={`${WRAP} grid lg:grid-cols-12 gap-10 lg:gap-12 items-center`}>
        <div className="lg:col-span-6 min-w-0">
          <h1 className="font-heading font-semibold tracking-[-0.03em] leading-[1.04] text-[1.875rem] sm:text-[3rem] lg:text-[clamp(3rem,4vw,3.75rem)] text-foreground">
            <span className="hero-line sm:whitespace-nowrap"><span>Gestão odontológica</span></span>{" "}
            <span className="hero-line"><span style={{ animationDelay: "110ms" }}>de A a Z</span></span>
          </h1>
          <p className="hero-fade mt-6 text-lg leading-relaxed text-foreground/80 max-w-[34rem]">
            CRM, agenda, WhatsApp da recepção, prontuário e financeiro em uma única plataforma,
            feita por quem tem clínica.
          </p>
          <div className="hero-fade mt-8 flex flex-col sm:flex-row gap-3">
            <Link to="/signup" search={{}} className={BTN_PRIMARY}>
              Iniciar teste grátis <ArrowRight className="h-4 w-4" />
            </Link>
            {WHATSAPP_CONSULTOR ? (
              <a href={WHATSAPP_CONSULTOR} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
                <Phone className="h-4 w-4" /> Falar com consultor
              </a>
            ) : (
              <a href="#funcionalidades" className={BTN_SECONDARY}>Ver funcionalidades</a>
            )}
          </div>
          <ul className="hero-fade mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[0.9375rem] text-muted-foreground">
            {[textoTesteGratis(diasTeste), "Sem fidelidade", "Suporte humano"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4 text-success" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-6 min-w-0">
          <div className="hero-stage rounded-lg bg-stage p-4 sm:p-8 lg:p-12">
            <AgendaFragment />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Faixa de clínicas (em espera) ──────────────────────── */

function TrustedBy() {
  return (
    <section className="py-12" aria-labelledby="quem-confia">
      <div className={WRAP}>
        <h2 id="quem-confia" className="text-[0.9375rem] font-medium text-muted-foreground">Quem confia no Odonto Connect</h2>
        <ul className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
          {["Sorriso Perfeito", "OdontoLife", "Dental Premium", "CliniSmile", "OralCenter", "DentCare Plus", "Odonto Excellence", "SmileLab"].map((n) => (
            <li key={n} className="font-heading text-lg font-semibold text-foreground/50">{n}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ─── Funcionalidades: cada uma com a prova ao lado ──────── */

function Features() {
  const destaques = features.filter((f) => f.highlight);
  const demais = features.filter((f) => !f.highlight);
  const provas: Record<string, ReactNode> = {
    "Reativação CRM Inteligente": <ProofReativacao />,
    "Agenda Clínica Completa": <ProofSemana />,
    "WhatsApp da clínica": <ProofConversa />,
    "Financeiro Integrado": <ProofCaixa />,
  };

  return (
    <section id="funcionalidades" className="scroll-mt-20 py-24 lg:py-36 bg-secondary">
      <div className={WRAP}>
        <ScrollReveal className="max-w-[44rem]">
          <h2 className="font-heading font-semibold tracking-[-0.02em] leading-[1.1] text-[1.625rem] sm:text-[2.125rem] lg:text-[2.5rem]">
            Tudo que sua clínica precisa, em um só lugar
          </h2>
          <p className="mt-4 text-lg text-foreground/80">
            Sistema completo desenvolvido por quem entende a rotina de uma clínica odontológica.
          </p>
        </ScrollReveal>

        <div className="mt-16 lg:mt-24 space-y-16 lg:space-y-28">
          {destaques.map((f) => (
            <ScrollReveal key={f.title} className="min-w-0">
              <article className="grid lg:grid-cols-12 gap-6 lg:gap-12 items-center">
                <div className="lg:col-span-5 min-w-0">
                  <h3 className="font-heading text-[1.625rem] sm:text-[1.875rem] font-semibold tracking-[-0.02em] leading-tight">{f.title}</h3>
                  <p className="mt-3 text-lg leading-relaxed text-foreground/80 max-w-[30rem]">{f.desc}</p>
                </div>
                <div className="lg:col-span-7 min-w-0">{provas[f.title]}</div>
              </article>
            </ScrollReveal>
          ))}
        </div>

        <div className="mt-24 lg:mt-36">
          <h3 className="font-heading text-[1.625rem] sm:text-[1.875rem] font-semibold tracking-[-0.02em]">E ainda</h3>
          <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-10">
            {demais.map((f) => (
              <li key={f.title}>
                <h4 className="text-lg font-semibold">{f.title}</h4>
                <p className="mt-2 text-[1rem] leading-relaxed text-foreground/75">{f.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* Provas: pedaços de interface com conteúdo de exemplo (data-ui). */

function ProofPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div data-ui className={`bg-card rounded-lg border border-border overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function ProofReativacao() {
  const [enviados, setEnviados] = useState<string[]>([]);
  const pacientes = [
    { nome: "Fernanda Alves", ultima: "Última consulta há 8 meses", proc: "Limpeza" },
    { nome: "Gustavo Rocha", ultima: "Orçamento parado há 45 dias", proc: "Implante" },
    { nome: "Larissa Prado", ultima: "Última consulta há 1 ano", proc: "Manutenção de aparelho" },
  ];
  return (
    <ProofPanel className="max-w-[560px]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <p className="text-[0.875rem] font-semibold">Para reativar</p>
        <p className="text-xs text-muted-foreground">{pacientes.length - enviados.length} pendentes</p>
      </div>
      <ul>
        {pacientes.map((p) => {
          const ok = enviados.includes(p.nome);
          return (
            <li key={p.nome} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
              <span className="h-8 w-8 rounded-full bg-accent text-accent-foreground text-xs font-semibold flex items-center justify-center shrink-0" aria-hidden="true">
                {p.nome.split(" ").map((w) => w[0]).join("")}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[0.875rem] font-medium truncate">{p.nome}</span>
                <span className="block text-xs text-muted-foreground truncate">{p.ultima} · {p.proc}</span>
              </span>
              <button
                type="button"
                onClick={() => setEnviados((e) => (ok ? e.filter((n) => n !== p.nome) : [...e, p.nome]))}
                className={`h-9 px-3 rounded text-xs font-semibold shrink-0 transition-colors ${
                  ok ? "bg-success/12 text-success" : "border border-input bg-card text-foreground hover:bg-muted"
                }`}
              >
                {ok ? "Na fila" : "Convidar"}
              </button>
            </li>
          );
        })}
      </ul>
    </ProofPanel>
  );
}

function ProofSemana() {
  const dias = [
    { d: "Seg", n: 18, c: 16 }, { d: "Ter", n: 22, c: 19 }, { d: "Qua", n: 15, c: 15 },
    { d: "Qui", n: 23, c: 20 }, { d: "Sex", n: 19, c: 12 }, { d: "Sáb", n: 8, c: 8 },
  ];
  const max = 24;
  return (
    <ProofPanel className="max-w-[620px] p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-[0.875rem] font-semibold">Consultas da semana</p>
        <p className="text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary mr-1.5 align-middle" />confirmadas
          <span className="inline-block h-2 w-2 rounded-sm bg-accent ml-3 mr-1.5 align-middle" />a confirmar
        </p>
      </div>
      <div className="mt-5 grid grid-cols-6 gap-3 items-end h-36">
        {dias.map((x) => (
          <div key={x.d} className="flex flex-col items-center gap-2 h-full justify-end">
            <span className="text-xs font-medium tabular-nums">{x.n}</span>
            <div className="w-full max-w-10 flex flex-col justify-end rounded-sm overflow-hidden" style={{ height: `${(x.n / max) * 100}%` }}>
              <div className="bg-accent" style={{ height: `${((x.n - x.c) / x.n) * 100}%` }} />
              <div className="bg-primary flex-1" />
            </div>
            <span className="text-xs text-muted-foreground">{x.d}</span>
          </div>
        ))}
      </div>
    </ProofPanel>
  );
}

function ProofConversa() {
  return (
    <ProofPanel className="max-w-[460px]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span className="h-8 w-8 rounded-full bg-success/15 text-success text-xs font-semibold flex items-center justify-center" aria-hidden="true">PM</span>
        <div>
          <p className="text-[0.875rem] font-semibold leading-tight">Paulo Martins</p>
          <p className="text-xs text-muted-foreground">WhatsApp · atendido pela recepção</p>
        </div>
      </div>
      <div className="chat-bg-pattern px-4 py-4 space-y-2.5 text-[0.875rem]">
        <p className="max-w-[80%] rounded-lg rounded-bl-sm bg-card px-3 py-2">Oi! Queria marcar uma limpeza essa semana.</p>
        <p className="max-w-[85%] ml-auto rounded-lg rounded-br-sm bg-primary text-primary-foreground px-3 py-2">
          Claro, Paulo! Tenho quinta às 14h ou sexta às 9h30 com a Dra. Paula. Qual prefere?
        </p>
        <p className="max-w-[80%] rounded-lg rounded-bl-sm bg-card px-3 py-2">Sexta 9h30.</p>
        <p className="max-w-[85%] ml-auto rounded-lg rounded-br-sm bg-primary text-primary-foreground px-3 py-2">
          Marcado: sexta, 9h30. Envio um lembrete na véspera.
        </p>
      </div>
    </ProofPanel>
  );
}

function ProofCaixa() {
  const mov = [
    { d: "Implante — Rafael Lima", v: 3200, tipo: "entrada" },
    { d: "Comissão — Dra. Paula", v: -640, tipo: "saida" },
    { d: "Clareamento — Ana Ribeiro", v: 850, tipo: "entrada" },
    { d: "Fornecedor — resinas", v: -410, tipo: "saida" },
  ];
  const saldo = mov.reduce((a, m) => a + m.v, 0);
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return (
    <ProofPanel className="max-w-[540px]">
      <div className="flex items-end justify-between px-4 pt-4 pb-3 border-b border-border">
        <div>
          <p className="text-xs text-muted-foreground">Saldo do dia</p>
          <p className="text-[1.5rem] font-semibold tabular-nums leading-tight">{brl(saldo)}</p>
        </div>
        <p className="text-xs text-muted-foreground">Fluxo de caixa</p>
      </div>
      <ul>
        {mov.map((m) => (
          <li key={m.d} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border last:border-0 text-[0.875rem]">
            <span className="truncate">{m.d}</span>
            <span className={`tabular-nums font-medium shrink-0 ${m.v > 0 ? "text-success" : "text-foreground/70"}`}>
              {m.v > 0 ? "+" : "−"} {brl(Math.abs(m.v))}
            </span>
          </li>
        ))}
      </ul>
    </ProofPanel>
  );
}

/* ─── Quem criou ─────────────────────────────────────────── */

function About() {
  const numeros = [
    { num: 15, suffix: "+", label: "Anos de experiência", verificado: true },
    { num: 500, suffix: "+", label: "Clínicas atendidas", verificado: false },
    { num: 98, suffix: "%", label: "Satisfação", verificado: false },
  ].filter((s) => s.verificado || PROVA_SOCIAL_CONFIRMADA);

  return (
    <section id="sobre" className="scroll-mt-20 py-24 lg:py-36">
      <div className={`${WRAP} grid lg:grid-cols-12 gap-10 lg:gap-16 items-center`}>
        <ScrollReveal className="lg:col-span-6 min-w-0">
          <img
            src={drLuisGustavo}
            alt="Dr. Luis Gustavo, fundador do Odonto Connect, no consultório"
            width={853}
            height={853}
            loading="lazy"
            className="w-full aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5] object-cover object-[70%_30%] rounded-lg"
          />
        </ScrollReveal>
        <ScrollReveal className="lg:col-span-6 min-w-0" delay={80}>
          <h2 className="font-heading font-semibold tracking-[-0.02em] leading-[1.1] text-[1.625rem] sm:text-[2.125rem] lg:text-[2.5rem]">
            Criado por quem vive a odontologia todos os dias
          </h2>
          <div className="mt-6 space-y-4 text-lg leading-relaxed text-foreground/85 max-w-[36rem]">
            <p>
              O Odonto Connect nasceu da experiência real do <strong className="font-semibold text-foreground">Dr. Luis Gustavo</strong>,
              implantodontista e dono de clínica há mais de 15 anos. Cansado de sistemas genéricos que não entendiam
              a rotina de uma clínica odontológica, ele decidiu criar a solução que sempre quis ter.
            </p>
            <p>
              Cada funcionalidade foi desenhada pensando nos problemas reais: pacientes que somem,
              WhatsApp que cai, agenda desorganizada, financeiro manual. O resultado é um sistema que
              realmente funciona porque foi feito por quem entende.
            </p>
          </div>
          <dl className="mt-10 flex gap-12">
            {numeros.map((s) => (
              <div key={s.label}>
                <dd className="font-heading text-[2.5rem] font-semibold leading-none tracking-tight text-primary tabular-nums">
                  <AnimatedCounter value={s.num} suffix={s.suffix} />
                </dd>
                <dt className="mt-2 text-[0.9375rem] text-muted-foreground">{s.label}</dt>
              </div>
            ))}
          </dl>
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ─── Planos: nomes à esquerda, um palco de preço ────────── */

// Recursos que não são limite numérico (por plano). Os limites vêm da API.
const EXTRAS_PLANO: Record<string, string[]> = {
  starter: ["CRM e agenda clínica", "Financeiro", "Suporte por e-mail"],
  pro: ["CRM com reativação de pacientes", "Disparos com fila e opção de SAIR", "Integração Clinicorp", "Meta Ads"],
  enterprise: ["Tudo do Profissional", "Relatórios clínicos com IA"],
};

const fmtN = (n: number) => n.toLocaleString("pt-BR");
function limitesDoPlano(p: Plan): string[] {
  const wa = p.max_whatsapp_instances;
  const u = p.max_usuarios;
  const d = p.max_dentistas;
  const pac = p.max_pacientes;
  return [
    wa == null ? "Sem limite de números de WhatsApp" : `${fmtN(wa)} ${wa === 1 ? "número" : "números"} de WhatsApp`,
    u == null && d == null
      ? "Sem limite de usuários e dentistas"
      : `${u == null ? "Usuários ilimitados" : `Até ${fmtN(u)} ${u === 1 ? "usuário" : "usuários"}`} e ${d == null ? "dentistas ilimitados" : `${fmtN(d)} ${d === 1 ? "dentista" : "dentistas"}`}`,
    pac == null ? "Sem limite de pacientes" : `Até ${fmtN(pac)} pacientes`,
  ];
}

function recursosPorFlag(p: Plan): string[] {
  const f = (p.features || {}) as Record<string, unknown>;
  return [f.clinicorp && "Integração Clinicorp", f.meta_ads && "Meta Ads", f.ia_avancada && "Relatórios clínicos com IA"].filter(Boolean) as string[];
}

/** Planos ativos da API no formato da landing; sem API, a lista de reserva. */
function planosDaLanding(api: Plan[] | null): typeof plans {
  if (!api?.length) return plans;
  return api.map((p) => ({
    slug: p.slug,
    name: p.nome,
    desc: p.descricao || "",
    features: [...limitesDoPlano(p), ...(EXTRAS_PLANO[p.slug] ?? recursosPorFlag(p))],
    popular: p.slug === "pro",
  }));
}

function Pricing() {
  const diasTeste = useTesteGratisDias();
  const { planos: planosApi } = usePlanosPublicos();
  const lista = planosDaLanding(planosApi);
  const [selSlug, setSelSlug] = useState<string>(plans.find((p) => p.popular)?.slug ?? plans[0].slug);
  const sel = Math.max(0, lista.findIndex((p) => p.slug === selSlug));
  const setSel = (i: number) => setSelSlug(lista[i]?.slug ?? selSlug);
  const plan = lista[sel];

  return (
    <section id="planos" className="scroll-mt-20 py-24 lg:py-36 bg-stage text-stage-foreground">
      <div className={WRAP}>
        <div className="max-w-[44rem]">
          <h2 className="font-heading font-semibold tracking-[-0.02em] leading-[1.1] text-[1.625rem] sm:text-[2.125rem] lg:text-[2.5rem]">
            Planos
          </h2>
          <p className="mt-4 text-lg text-stage-muted">
            Teste por {diasTeste} dias, sem cartão de crédito. Para saber o valor de cada plano, fale com a nossa equipe.
          </p>
        </div>

        {/* Computador: seletor + palco fixo */}
        <div className="hidden lg:grid grid-cols-12 gap-12 mt-20">
          <div className="col-span-5" role="tablist" aria-label="Planos" aria-orientation="vertical">
            {lista.map((p, i) => (
              <button
                key={p.slug}
                role="tab"
                id={`plano-${p.slug}`}
                aria-selected={i === sel}
                aria-controls="plano-palco"
                onClick={() => setSel(i)}
                onFocus={() => setSel(i)}
                className={`group flex w-full items-center gap-4 py-3 text-left font-heading text-[3.5rem] leading-[1.1] font-semibold tracking-[-0.03em] transition-colors ${
                  i === sel ? "text-stage-foreground" : "text-stage-foreground/35 hover:text-stage-foreground/70"
                }`}
              >
                <span className={`h-3 w-3 rounded-full bg-[var(--color-dental-cyan)] transition-opacity ${i === sel ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                {p.name}
                {p.popular && (
                  <span className="whitespace-nowrap text-[0.9375rem] font-medium tracking-normal text-stage-muted">· Recomendado</span>
                )}
              </button>
            ))}
          </div>
          <div id="plano-palco" role="tabpanel" aria-labelledby={`plano-${plan.slug}`} className="col-span-7">
            <PlanStage plan={plan} key={plan.slug} />
          </div>
        </div>

        {/* Celular e tablet: os três planos completos, um abaixo do outro */}
        <div className="lg:hidden mt-12 space-y-12">
          {lista.map((p) => (
            <div key={p.slug} className="rounded-lg bg-white/[0.06] p-6">
              <h3 className="font-heading text-[1.875rem] font-semibold tracking-[-0.02em] leading-tight">
                {p.name}
                {p.popular && <span className="ml-2 text-[0.9375rem] font-medium tracking-normal text-stage-muted">· Recomendado</span>}
              </h3>
              <PlanStage plan={p} compact />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PlanStage({ plan, compact = false }: { plan: (typeof plans)[number]; compact?: boolean }) {
  return (
    <div className={compact ? "mt-3" : "animate-fade-in"}>
      <p className={compact ? "mt-1 text-[1rem] text-stage-muted" : "font-heading text-[1.75rem] font-semibold tracking-[-0.02em] leading-tight"}>{plan.desc}</p>
      <ul className={`grid gap-x-8 gap-y-2.5 ${compact ? "mt-5" : "mt-8 sm:grid-cols-2"}`}>
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[1rem]">
            <CheckCircle className="h-4 w-4 mt-1 shrink-0 text-[var(--color-dental-cyan)]" aria-hidden="true" />
            {f}
          </li>
        ))}
      </ul>
      <div className={`mt-8 flex gap-x-6 gap-y-3 ${compact ? "flex-col" : "flex-wrap items-center"}`}>
      <Link
        to="/signup"
        search={{ plan: plan.slug }}
        className={`inline-flex items-center justify-center gap-2 h-12 px-6 rounded-md bg-stage-foreground text-stage text-[0.9375rem] font-semibold hover:bg-white active:translate-y-px transition-[background-color,transform] ${compact ? "w-full" : ""}`}
      >
        Testar o {plan.name} grátis <ArrowRight className="h-4 w-4" />
      </Link>
      <a
        href={`mailto:${EMAIL_CONTATO}?subject=${encodeURIComponent(`Valores do plano ${plan.name}`)}`}
        className="inline-flex items-center justify-center gap-2 min-h-11 text-[0.9375rem] font-semibold text-stage-foreground underline-offset-4 hover:underline"
      >
        <Mail className="h-4 w-4" aria-hidden="true" /> Consultar valores
      </a>
      </div>
    </div>
  );
}

/* ─── Depoimentos (em espera) ────────────────────────────── */

function Testimonials() {
  return (
    <section id="depoimentos" className="scroll-mt-20 py-24 lg:py-36">
      <div className={WRAP}>
        <h2 className="font-heading font-semibold tracking-[-0.02em] text-[1.625rem] sm:text-[2.125rem] lg:text-[2.5rem]">Quem usa, recomenda</h2>
        <div className="mt-12 grid md:grid-cols-3 gap-10">
          {testimonials.map((t) => (
            <figure key={t.name}>
              <div className="flex gap-0.5" aria-label={`${t.stars} de 5 estrelas`}>
                {Array.from({ length: t.stars }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-warning text-warning" aria-hidden="true" />
                ))}
              </div>
              <blockquote className="mt-4 text-[1.1875rem] leading-relaxed">“{t.text}”</blockquote>
              <figcaption className="mt-4 text-[0.9375rem] text-muted-foreground">
                <span className="font-semibold text-foreground">{t.name}</span> · {t.clinic}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Dúvidas ────────────────────────────────────────────── */

function Faq() {
  const faqs = faqsCom(useTesteGratisDias());
  return (
    <section id="faq" className="scroll-mt-20 py-24 lg:py-36">
      <div className={`${WRAP} grid lg:grid-cols-12 gap-10 lg:gap-12`}>
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <h2 className="font-heading font-semibold tracking-[-0.02em] leading-[1.1] text-[1.625rem] sm:text-[2.125rem] lg:text-[2.5rem]">
              Perguntas frequentes
            </h2>
            <p className="mt-4 text-lg text-foreground/80">Tire suas dúvidas sobre o Odonto Connect.</p>
            <a href={WHATSAPP_CONSULTOR ?? `mailto:${EMAIL_CONTATO}`} {...(WHATSAPP_CONSULTOR ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="mt-6 inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-primary hover:underline underline-offset-4">
              Outra dúvida? Fale com a nossa equipe <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
        <div className="lg:col-span-8 space-y-2">
          {faqs.map((item, i) => (
            <details key={item.q} name="faq" className="faq-tile group rounded-lg bg-secondary open:bg-accent transition-colors" open={i === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 px-6 py-5 text-lg sm:text-[1.125rem] font-semibold [&::-webkit-details-marker]:hidden">
                {item.q}
                <Plus className="h-5 w-5 shrink-0 text-primary transition-transform duration-200 group-open:rotate-45" aria-hidden="true" />
              </summary>
              <p className="px-6 pb-6 -mt-1 text-[1rem] leading-relaxed text-foreground/85 max-w-[52ch]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Chamada final ──────────────────────────────────────── */

function FinalCta() {
  const diasTeste = useTesteGratisDias();
  return (
    <section className="pb-24 lg:pb-36">
      <div className={WRAP}>
        <div className="rounded-lg bg-primary text-primary-foreground px-6 py-14 sm:px-12 lg:px-16 lg:py-20 grid lg:grid-cols-12 gap-8 items-end">
          <div className="lg:col-span-8">
            <h2 className="font-heading font-semibold tracking-[-0.02em] leading-[1.1] text-[1.625rem] sm:text-[2.125rem] lg:text-[3rem]">
              Veja a sua clínica no Odonto Connect
            </h2>
            <p className="mt-4 text-lg text-primary-foreground/85 max-w-[40rem]">
              {PROVA_SOCIAL_CONFIRMADA && "Junte-se a centenas de clínicas que já estão crescendo com o Odonto Connect. "}
              Comece seu teste gratuito de {diasTeste} dias agora.
            </p>
          </div>
          <div className="lg:col-span-4 lg:justify-self-end">
            <Link
              to="/signup"
              search={{}}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 h-12 px-6 rounded-md bg-white text-accent-foreground text-[0.9375rem] font-semibold hover:bg-white/90 active:translate-y-px transition-[background-color,transform]"
            >
              Criar conta de teste <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Rodapé ─────────────────────────────────────────────── */

function SiteFooter() {
  return (
    <footer className="pb-10">
      <div className={WRAP}>
        <img src={logoHorizontal} alt="Odonto Connect" className="w-full max-w-[720px] h-auto opacity-90" width={1920} height={194} loading="lazy" />
        <div className="mt-10 grid gap-6 md:grid-cols-[1fr_auto_1fr] md:items-center text-[0.9375rem]">
          <p className="text-muted-foreground">Sistema completo de A a Z para clínicas odontológicas. De dono de clínica para dono.</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 font-medium">
            <li><a href="#funcionalidades" className="hover:text-primary transition-colors">Funcionalidades</a></li>
            <li><a href="#planos" className="hover:text-primary transition-colors">Planos</a></li>
            {WHATSAPP_CONSULTOR && (
              <li>
                <a href={WHATSAPP_CONSULTOR} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-primary transition-colors">
                  <Phone className="h-4 w-4" aria-hidden="true" /> WhatsApp
                </a>
              </li>
            )}
            <li>
              <a href={`mailto:${EMAIL_CONTATO}`} className="inline-flex items-center gap-1.5 hover:text-primary transition-colors">
                <Mail className="h-4 w-4" aria-hidden="true" /> E-mail
              </a>
            </li>
          </ul>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 md:justify-end text-muted-foreground">
            <li><Link to="/termos" className="hover:text-foreground transition-colors">Termos de Uso</Link></li>
            <li><Link to="/privacidade" className="hover:text-foreground transition-colors">Política de Privacidade</Link></li>
            <li>© {new Date().getFullYear()} Odonto Connect</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
