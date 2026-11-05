import {
  Send,
  LayoutDashboard,
  MessageSquare,
  Radio,
  DollarSign,
  Settings,
  LogOut,
  ChevronDown,
  Sun,
  Moon,
  Users,
  Megaphone,
  BarChart3,
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
  Pin,
  PinOff,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useChatUnreadCount } from "@/lib/chatUnreadStore";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import logoImg from "@/assets/symbol.jpg";

import { canAccessRoute } from "@/lib/routeAccess";

interface NavItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Principal",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Meu Painel", url: "/painel-dentista", icon: Stethoscope },
      { title: "Agenda", url: "/agenda", icon: CalendarDays },
    ],
  },
  {
    label: "Clínico",
    items: [
      { title: "Consulta", url: "/atendimento", icon: Headset },
      { title: "Pacientes", url: "/pacientes", icon: UserRound },
      { title: "Dentistas", url: "/dentistas", icon: Stethoscope },
      { title: "Exames", url: "/exames", icon: FileHeart },
      { title: "Pedido de Exame", url: "/pedido-exame", icon: FileText },
      { title: "Prontuário", url: "/prontuario", icon: FileHeart },
      { title: "Relatórios IA", url: "/relatorios-clinicos", icon: FileHeart },
      { title: "Orçamentos", url: "/orcamentos", icon: Receipt },
      { title: "Tratamentos", url: "/tratamentos", icon: ClipboardList },
      { title: "Catálogo de Procedimentos", url: "/procedimentos", icon: ClipboardList },
    ],
  },
  {
    label: "Comercial",
    items: [
      { title: "Painel Comercial", url: "/painel-comercial", icon: Headset },
      { title: "Chat", url: "/chat", icon: MessageSquare },
      { title: "Contatos", url: "/contatos", icon: Contact },
      { title: "CRM & Funil", url: "/crm", icon: Users },
      { title: "Automações", url: "/automacoes", icon: Zap },
      { title: "Disparos", url: "/disparos", icon: Send },
      { title: "Reativação", url: "/reativacao", icon: RefreshCcw },
      { title: "Métricas", url: "/metricas", icon: Timer },
    ],
  },
  {
    label: "Marketing",
    items: [
      { title: "Campanhas", url: "/campanhas", icon: Megaphone },
      { title: "Integrações & Clinicorp", url: "/integracoes", icon: Plug },
      { title: "ROI & Analytics", url: "/analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Gestão",
    items: [
      { title: "Financeiro", url: "/financeiro", icon: DollarSign },
      { title: "Comissões", url: "/comissoes", icon: Percent },
      { title: "Estoque", url: "/estoque", icon: Package },
      { title: "Canais", url: "/canais", icon: Radio },
      { title: "Equipe", url: "/equipe", icon: UserCog },
      { title: "Usuários", url: "/usuarios", icon: UserCog },
      { title: "Minha Assinatura", url: "/minha-assinatura", icon: Settings },
      { title: "Super Admin", url: "/super-admin", icon: Settings },
      
      { title: "Configurações", url: "/configuracoes", icon: Settings },
    ],
  },
];

const superAdminSections: NavSection[] = [
  {
    label: "SaaS Management",
    items: [
      { title: "Painel Global", url: "/super-admin", icon: LayoutDashboard },
      { title: "Configurações SaaS", url: "/super-admin", icon: Settings },
    ],
  },
];

function filterByRole(
  sections: NavSection[], 
  role: string, 
  isSuperAdmin?: boolean, 
  tenantFeatures?: Record<string, boolean>
): NavSection[] {
  // Super Admin vê TUDO + a seção exclusiva de SaaS Management
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

export function AppSidebar() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const chatUnread = useChatUnreadCount();

  // Inject dynamic chat badge
  const visibleSections = useMemo(() => {
    const sections = filterByRole(navSections, user?.role ?? "user", !!user?.is_super_admin, user?.tenant_features);
    if (chatUnread > 0) {
      return sections.map((s) => ({
        ...s,
        items: s.items.map((item) =>
          item.url === "/chat" ? { ...item, badge: chatUnread } : item
        ),
      }));
    }
    return sections;
  }, [user?.role, user?.is_super_admin, user?.tenant_features, chatUnread]);

  // Fecha a gaveta do celular ao trocar de página
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const expanded = pinned || hovered;

  // Auto-expand the section that contains the active route
  const activeSectionLabel = visibleSections.find((s) =>
    s.items.some((i) => i.url === location.pathname)
  )?.label;

  const nav = (isExpanded: boolean) => (
    <nav className="flex-1 py-3 px-2 space-y-3 overflow-y-auto overscroll-contain scrollbar-thin" aria-label="Menu principal">
      {visibleSections.map((section) => (
        <CollapsibleSection
          key={section.label}
          section={section}
          expanded={isExpanded}
          activePath={location.pathname}
          defaultOpen={section.label === activeSectionLabel || section.label === "Principal"}
        />
      ))}
    </nav>
  );

  return (
    <>
      {/* Celular: barra superior com o menu em gaveta */}
      <div className="md:hidden flex items-center gap-3 h-14 px-3 bg-sidebar border-b border-sidebar-border shrink-0">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center justify-center h-10 w-10 -ml-1 rounded-md text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <img src={logoImg} alt="" className="h-6 w-12 rounded object-cover" />
        <span className="text-[15px] font-semibold tracking-tight font-heading text-sidebar-foreground">Odonto Connect</span>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="md:hidden w-[288px] max-w-[85vw] p-0 flex flex-col bg-sidebar text-sidebar-foreground gap-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Navegação do Odonto Connect</SheetDescription>
          <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border shrink-0">
            <img src={logoImg} alt="" className="h-6 w-12 rounded object-cover" />
            <span className="text-[15px] font-semibold tracking-tight font-heading">Odonto Connect</span>
          </div>
          {nav(true)}
          <SidebarUserFooter expanded />
        </SheetContent>
      </Sheet>

      {/* Computador: trilho de 64 px que abre por cima do conteúdo ao passar o mouse,
          ou fixo em 248 px quando o usuário fixa o menu. */}
      <aside
        className={`hidden md:block relative shrink-0 z-30 transition-[width] duration-200 ${pinned ? "w-[248px]" : "w-16"}`}
      >
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={`absolute inset-y-0 left-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width,box-shadow] duration-200 ${
            expanded ? "w-[248px]" : "w-16"
          } ${hovered && !pinned ? "shadow-xl" : ""}`}
        >
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-2 h-[64px] border-b border-sidebar-border shrink-0">
            <img src={logoImg} alt="Odonto Connect" className="h-6 w-12 rounded object-cover shrink-0" />
            {expanded && (
              <>
                <span className="flex-1 min-w-0 text-[15px] font-semibold tracking-tight text-sidebar-foreground font-heading truncate">
                  Odonto Connect
                </span>
                <button
                  onClick={() => setPinned(!pinned)}
                  className="flex items-center justify-center h-8 w-8 rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground shrink-0"
                  title={pinned ? "Soltar menu" : "Fixar menu aberto"}
                  aria-label={pinned ? "Soltar menu" : "Fixar menu aberto"}
                  aria-pressed={pinned}
                >
                  {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </button>
              </>
            )}
          </div>
          {nav(expanded)}
          <SidebarUserFooter expanded={expanded} />
        </div>
      </aside>
    </>
  );
}

function CollapsibleSection({
  section,
  expanded,
  activePath,
  defaultOpen,
}: {
  section: NavSection;
  expanded: boolean;
  activePath: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Trilho recolhido: todos os ícones, seções separadas por espaço
  if (!expanded) {
    return (
      <div className="space-y-0.5">
        {section.items.map((item) => {
          const isActive = activePath === item.url;
          return (
            <Link
              key={item.title}
              to={item.url}
              className={`flex items-center justify-center h-10 w-10 mx-auto rounded-md transition-colors relative ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
              title={item.title}
              aria-label={item.title}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.badge ? (
                <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-4 text-center tabular-nums">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center w-full h-8 px-2.5 rounded-md text-xs font-semibold text-muted-foreground hover:text-sidebar-foreground transition-colors"
        aria-expanded={open}
      >
        <span className="flex-1 text-left">{section.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="space-y-0.5 mt-0.5">
          {section.items.map((item) => {
            const isActive = activePath === item.url;
            return (
              <Link
                key={item.title}
                to={item.url}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 h-9 px-2.5 rounded-md text-[13px] transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "text-sidebar-foreground/80 font-medium hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-sidebar-primary" : "opacity-80"}`} />
                <span className="flex-1 truncate">{item.title}</span>
                {item.badge ? (
                  <span className={`h-5 min-w-5 px-1.5 rounded-full text-[11px] font-semibold leading-5 text-center tabular-nums ${
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "bg-destructive text-destructive-foreground"
                  }`}>
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SidebarUserFooter({ expanded }: { expanded: boolean }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const roleLabel = user?.is_super_admin ? "Super Admin" : user?.role ?? "";

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "??";

  const handleLogout = async () => {
    // Espera a sessão sair; senão /login ainda vê o usuário e volta ao dashboard
    await logout();
    navigate({ to: "/login" });
  };

  const avatar = user?.avatar_url ? (
    <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
  ) : (
    <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-[11px] font-semibold text-primary-foreground shrink-0" aria-hidden="true">
      {initials}
    </div>
  );

  const iconBtn = "flex items-center justify-center h-9 w-9 rounded-md text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors";
  const themeLabel = theme === "dark" ? "Modo claro" : "Modo escuro";

  if (!expanded) {
    return (
      <div className="p-2 border-t border-sidebar-border shrink-0 flex flex-col items-center gap-1">
        <Link to="/perfil" className="rounded-full" title="Meu perfil" aria-label="Meu perfil">
          {avatar}
        </Link>
        <button onClick={toggleTheme} className={iconBtn} title={themeLabel} aria-label={themeLabel}>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button onClick={handleLogout} className={iconBtn} title="Sair" aria-label="Sair">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-2 border-t border-sidebar-border shrink-0 flex items-center gap-1">
      <Link to="/perfil" className="flex flex-1 min-w-0 items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-sidebar-accent transition-colors" title="Meu perfil">
        {avatar}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-sidebar-foreground leading-tight truncate">{user?.name ?? "Usuário"}</p>
          <p className="text-xs text-muted-foreground capitalize truncate">{roleLabel}</p>
        </div>
      </Link>
      <button onClick={toggleTheme} className={iconBtn} title={themeLabel} aria-label={themeLabel}>
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <button onClick={handleLogout} className={iconBtn} title="Sair" aria-label="Sair">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
