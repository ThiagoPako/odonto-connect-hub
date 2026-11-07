import {
  Send,
  LayoutDashboard,
  MessageSquare,
  Radio,
  DollarSign,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Sun,
  Moon,
  Users,
  Megaphone,
  UserCog,
  RefreshCcw,
  Plug,
  Zap,
  CalendarDays,
  FileHeart,
  Receipt,
  Package,
  ClipboardList,
  Percent,
  Stethoscope,
  UserRound,
  Headset,
  Timer,
  Contact,
  FileText,
  Menu,
  Crown,
  CreditCard,
  ScanLine,
  Sparkles,
  BookOpen,
  BriefcaseMedical,
  Presentation,
  UserCircle,
  ChevronsUpDown,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useChatUnreadCount } from "@/lib/chatUnreadStore";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import logoImg from "@/assets/symbol.jpg";
import { cn } from "@/lib/utils";
import { canAccessRoute } from "@/lib/routeAccess";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  badge?: number;
  /** Tela funcional, mas ainda com limitações (ex.: dados só neste navegador). */
  beta?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// Ordem e nomes seguem o fluxo da clínica (docs/produto/mapa-telas.md):
// rotina do dia → clínico → relacionamento/comercial → gestão → configuração.
// Cada item tem ícone próprio para ser reconhecível com o menu recolhido.
const navSections: NavSection[] = [
  {
    label: "Principal",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Meu Painel", url: "/painel-dentista", icon: BriefcaseMedical },
      { title: "Agenda", url: "/agenda", icon: CalendarDays },
    ],
  },
  {
    label: "Clínico",
    items: [
      { title: "Consulta", url: "/atendimento", icon: Stethoscope },
      { title: "Pacientes", url: "/pacientes", icon: UserRound },
      { title: "Prontuário", url: "/prontuario", icon: FileHeart },
      { title: "Exames", url: "/exames", icon: ScanLine },
      { title: "Pedido de Exame", url: "/pedido-exame", icon: FileText },
      { title: "Orçamentos", url: "/orcamentos", icon: Receipt },
      { title: "Tratamentos", url: "/tratamentos", icon: ClipboardList },
      { title: "Relatórios IA", url: "/relatorios-clinicos", icon: Sparkles },
      { title: "Dentistas", url: "/dentistas", icon: Users },
      { title: "Procedimentos", url: "/procedimentos", icon: BookOpen },
    ],
  },
  {
    label: "Comercial",
    items: [
      { title: "Painel Comercial", url: "/painel-comercial", icon: Presentation },
      { title: "Chat", url: "/chat", icon: MessageSquare },
      { title: "Contatos", url: "/contatos", icon: Contact },
      { title: "CRM & Funil", url: "/crm", icon: Headset },
      { title: "Disparos", url: "/disparos", icon: Send },
      { title: "Campanhas", url: "/campanhas", icon: Megaphone, beta: true },
      { title: "Automações", url: "/automacoes", icon: Zap },
      { title: "Reativação", url: "/reativacao", icon: RefreshCcw },
      { title: "Métricas", url: "/metricas", icon: Timer },
      // "ROI & Analytics" (/analytics) fica fora do menu enquanto a tela for "em breve".
    ],
  },
  {
    label: "Gestão",
    items: [
      { title: "Financeiro", url: "/financeiro", icon: DollarSign },
      { title: "Comissões", url: "/comissoes", icon: Percent },
      { title: "Estoque", url: "/estoque", icon: Package },
      // "Equipe" (/equipe) fica fora do menu enquanto a tela for "em breve".
    ],
  },
  {
    label: "Configuração",
    items: [
      { title: "Canais WhatsApp", url: "/canais", icon: Radio },
      { title: "Integrações", url: "/integracoes", icon: Plug },
      { title: "Usuários", url: "/usuarios", icon: UserCog },
      { title: "Minha Assinatura", url: "/minha-assinatura", icon: CreditCard },
      { title: "Configurações", url: "/configuracoes", icon: Settings },
    ],
  },
];

const superAdminSections: NavSection[] = [
  {
    label: "Plataforma (SaaS)",
    items: [{ title: "Super Admin", url: "/super-admin", icon: Crown }],
  },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador(a)",
  dentista: "Dentista",
  recepcionista: "Recepção",
  comercial: "Comercial",
  user: "Usuário",
};

function filterByRole(
  sections: NavSection[],
  role: string,
  isSuperAdmin?: boolean,
  tenantFeatures?: Record<string, boolean>,
): NavSection[] {
  // Super Admin vê TUDO + a seção exclusiva da plataforma
  if (isSuperAdmin) {
    return [...sections, ...superAdminSections];
  }

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessRoute(item.url, role, isSuperAdmin, tenantFeatures)),
    }))
    .filter((section) => section.items.length > 0);
}

function isActivePath(activePath: string, url: string) {
  return activePath === url || activePath.startsWith(url + "/");
}

const STORAGE_EXPANDED = "oc.sidebar.expanded";
const STORAGE_CLOSED_SECTIONS = "oc.sidebar.closedSections";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function useNavSections() {
  const { user } = useAuth();
  const chatUnread = useChatUnreadCount();
  return useMemo(() => {
    const sections = filterByRole(navSections, user?.role ?? "user", !!user?.is_super_admin, user?.tenant_features);
    if (chatUnread > 0) {
      return sections.map((s) => ({
        ...s,
        items: s.items.map((item) => (item.url === "/chat" ? { ...item, badge: chatUnread } : item)),
      }));
    }
    return sections;
  }, [user?.role, user?.is_super_admin, user?.tenant_features, chatUnread]);
}

/** Grupos recolhidos pelo usuário (persistidos). Por padrão todos ficam abertos. */
function useClosedSections() {
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => {
    setClosed(readJSON<string[]>(STORAGE_CLOSED_SECTIONS, []));
  }, []);
  const toggle = useCallback((label: string) => {
    setClosed((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label];
      try {
        localStorage.setItem(STORAGE_CLOSED_SECTIONS, JSON.stringify(next));
      } catch {
        /* sem armazenamento: só não persiste */
      }
      return next;
    });
  }, []);
  return { closed, toggle };
}

/* ------------------------------------------------------------------ */
/* Desktop (>= md): trilho recolhido ou menu expandido                 */
/* ------------------------------------------------------------------ */

export function AppSidebar() {
  // Expandido por padrão em telas largas (>= 1280 px); recolhido em tablets.
  // A escolha do usuário fica salva e vale nas próximas visitas.
  const [expanded, setExpanded] = useState(true);
  const location = useLocation();
  const sections = useNavSections();
  const { closed, toggle } = useClosedSections();

  useEffect(() => {
    const saved = readJSON<boolean | null>(STORAGE_EXPANDED, null);
    setExpanded(saved ?? window.matchMedia("(min-width: 1280px)").matches);
  }, []);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      try {
        localStorage.setItem(STORAGE_EXPANDED, JSON.stringify(!prev));
      } catch {
        /* ignora */
      }
      return !prev;
    });
  };

  // O grupo da tela atual sempre aparece aberto, mesmo que o usuário o tenha recolhido.
  const activeSection = sections.find((s) => s.items.some((i) => isActivePath(location.pathname, i.url)))?.label;

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        aria-label="Menu principal"
        className={cn(
          "hidden md:flex flex-col shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200 relative z-30",
          expanded ? "w-64" : "w-[68px]",
        )}
      >
        <div className={cn("flex items-center gap-2.5 h-16 shrink-0 border-b border-sidebar-border", expanded ? "px-4" : "justify-center px-2")}>
          <img src={logoImg} alt="" className="h-8 w-8 rounded-lg shrink-0 shadow-sm" />
          {expanded && (
            <span className="flex-1 min-w-0 text-sm font-bold tracking-tight font-heading leading-tight">Odonto Connect</span>
          )}
          {expanded && (
            <button
              type="button"
              onClick={toggleExpanded}
              className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              aria-label="Recolher menu"
              title="Recolher menu"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        {!expanded && (
          <div className="px-2 pt-2">
            <RailTooltip label="Expandir menu">
              <button
                type="button"
                onClick={toggleExpanded}
                className="h-9 w-full inline-flex items-center justify-center rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                aria-label="Expandir menu"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </RailTooltip>
          </div>
        )}

        <nav className={cn("flex-1 overflow-y-auto overscroll-contain scrollbar-thin py-2", expanded ? "px-3" : "px-2")}>
          {expanded ? (
            <NavSections
              sections={sections}
              activePath={location.pathname}
              closed={closed}
              onToggle={toggle}
              activeSection={activeSection}
            />
          ) : (
            <RailSections sections={sections} activePath={location.pathname} />
          )}
        </nav>

        <SidebarUserMenu expanded={expanded} />
      </aside>
    </TooltipProvider>
  );
}

function RailTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function RailSections({ sections, activePath }: { sections: NavSection[]; activePath: string }) {
  return (
    <ul className="space-y-1">
      {sections.map((section, si) => (
        <li key={section.label}>
          {si > 0 && <div className="my-2 mx-2 border-t border-sidebar-border" role="presentation" />}
          <p className="sr-only">{section.label}</p>
          <ul className="space-y-1">
            {section.items.map((item) => {
              const active = isActivePath(activePath, item.url);
              const label = item.beta ? `${item.title} (beta)` : item.title;
              return (
                <li key={item.url}>
                  <RailTooltip label={item.badge ? `${label} — ${item.badge} não lida(s)` : label}>
                    <Link
                      to={item.url}
                      aria-label={label}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex h-10 w-full items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                        active
                          ? "bg-sidebar-accent text-sidebar-primary"
                          : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                      )}
                    >
                      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-sidebar-primary" />}
                      <item.icon className="h-[18px] w-[18px]" />
                      {!!item.badge && (
                        <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-4 text-center">
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </Link>
                  </RailTooltip>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function NavSections({
  sections,
  activePath,
  closed,
  onToggle,
  activeSection,
  onNavigate,
}: {
  sections: NavSection[];
  activePath: string;
  closed: string[];
  onToggle: (label: string) => void;
  activeSection?: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-3">
      {sections.map((section) => {
        const open = !closed.includes(section.label) || section.label === activeSection;
        const id = `nav-sec-${section.label.replace(/\W+/g, "-").toLowerCase()}`;
        return (
          <div key={section.label}>
            <button
              type="button"
              onClick={() => onToggle(section.label)}
              aria-expanded={open}
              aria-controls={id}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <span className="flex-1 text-left">{section.label}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !open && "-rotate-90")} />
            </button>
            {open && (
              <ul id={id} className="mt-1 space-y-0.5">
                {section.items.map((item) => {
                  const active = isActivePath(activePath, item.url);
                  return (
                    <li key={item.url}>
                      <Link
                        to={item.url}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                            : "font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                        )}
                      >
                        {active && <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-sidebar-primary" />}
                        <item.icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-sidebar-primary")} />
                        {/* Sem truncate: o rótulo quebra linha em vez de ser cortado. */}
                        <span className="flex-1 min-w-0 break-words">{item.title}</span>
                        {item.beta && (
                          <span
                            className="shrink-0 rounded-full bg-sidebar-primary/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-sidebar-accent-foreground"
                            title="Funciona, mas ainda tem limitações"
                          >
                            Beta
                          </span>
                        )}
                        {!!item.badge && (
                          <span
                            className={cn(
                              "shrink-0 min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold leading-5 text-center",
                              active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "bg-destructive text-destructive-foreground",
                            )}
                            aria-label={`${item.badge} não lida(s)`}
                          >
                            {item.badge > 99 ? "99+" : item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Celular (< md): barra superior + menu em Sheet                      */
/* ------------------------------------------------------------------ */

export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const sections = useNavSections();
  const { closed, toggle } = useClosedSections();
  const activeSection = sections.find((s) => s.items.some((i) => isActivePath(location.pathname, i.url)))?.label;
  const unread = sections.flatMap((s) => s.items).find((i) => i.url === "/chat")?.badge ?? 0;

  // Fecha o menu ao trocar de tela (inclusive pelo botão voltar).
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <>
      <div className="md:hidden flex items-center gap-2 h-14 shrink-0 px-2 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative h-11 w-11 inline-flex items-center justify-center rounded-lg hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label={unread ? `Abrir menu (${unread} mensagens não lidas)` : "Abrir menu"}
          aria-expanded={open}
        >
          <Menu className="h-5 w-5" />
          {!!unread && <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-sidebar" />}
        </button>
        <img src={logoImg} alt="" className="h-7 w-7 rounded-md shrink-0" />
        {/* O nome da tela já aparece no cabeçalho da página logo abaixo. */}
        <span className="flex-1 min-w-0 text-sm font-bold font-heading leading-tight">Odonto Connect</span>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-xs p-0 flex flex-col gap-0 bg-sidebar text-sidebar-foreground">
          <div className="flex items-center gap-2.5 h-14 shrink-0 px-4 pr-12 border-b border-sidebar-border">
            <img src={logoImg} alt="" className="h-8 w-8 rounded-lg shrink-0" />
            <SheetTitle className="text-sm font-bold font-heading">Odonto Connect</SheetTitle>
            <SheetDescription className="sr-only">Navegação entre as telas do sistema</SheetDescription>
          </div>
          <nav aria-label="Menu principal" className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
            <NavSections
              sections={sections}
              activePath={location.pathname}
              closed={closed}
              onToggle={toggle}
              activeSection={activeSection}
              onNavigate={() => setOpen(false)}
            />
          </nav>
          <SidebarUserMenu expanded />
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Menu do usuário (perfil, tema, sair)                                */
/* ------------------------------------------------------------------ */

function SidebarUserMenu({ expanded }: { expanded: boolean }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const roleLabel = user?.is_super_admin ? "Super Admin" : ROLE_LABELS[user?.role ?? ""] ?? user?.role ?? "";
  const name = user?.name ?? "Usuário";

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "??";

  const handleLogout = async () => {
    // Espera a sessão sair; senão /login ainda vê o usuário e volta ao dashboard
    await logout();
    navigate({ to: "/login" });
  };

  const avatar = user?.avatar_url ? (
    <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-lg object-cover shadow-sm shrink-0" />
  ) : (
    <span className="h-8 w-8 rounded-lg gradient-primary inline-flex items-center justify-center text-[11px] font-bold text-primary-foreground shadow-sm shrink-0">
      {initials}
    </span>
  );

  const trigger = (
    <DropdownMenuTrigger
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent",
        expanded ? "px-2 py-2" : "justify-center p-1.5",
      )}
      aria-label={`Menu da conta de ${name}`}
    >
      {avatar}
      {expanded && (
        <>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold leading-tight break-words">{name}</span>
            {roleLabel && <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">{roleLabel}</span>}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </>
      )}
    </DropdownMenuTrigger>
  );

  return (
    <div className={cn("shrink-0 border-t border-sidebar-border", expanded ? "p-3" : "p-2")}>
      <DropdownMenu>
        {expanded ? trigger : <RailTooltip label={name}>{trigger}</RailTooltip>}
        <DropdownMenuContent side={expanded ? "top" : "right"} align={expanded ? "start" : "end"} className="w-60">
          <DropdownMenuLabel className="font-normal">
            <span className="block text-sm font-semibold break-words">{name}</span>
            {user?.email && <span className="block text-xs text-muted-foreground break-all">{user.email}</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate({ to: "/perfil" })}>
            <UserCircle /> Meu perfil
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              toggleTheme();
            }}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
            {theme === "dark" ? "Modo claro" : "Modo escuro"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleLogout} className="text-destructive focus:text-destructive">
            <LogOut /> Sair
          </DropdownMenuItem>
          <p className="px-2 pt-1 pb-0.5 text-[10px] text-muted-foreground">v2.1.1</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
