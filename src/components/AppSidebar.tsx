import {
  Send,
  LayoutDashboard,
  MessageSquare,
  Radio,
  DollarSign,
  Settings,
  LogOut,
  ChevronLeft,
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
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useChatUnreadCount } from "@/lib/chatUnreadStore";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import logoImg from "@/assets/logo.png";

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
      { title: "Prontuário", url: "/prontuario", icon: FileHeart },
      { title: "Relatórios IA", url: "/relatorios-clinicos", icon: FileHeart },
      { title: "Orçamentos", url: "/orcamentos", icon: Receipt },
      { title: "Tratamentos", url: "/tratamentos", icon: ClipboardList },
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
      { title: "Integrações Ads", url: "/integracoes", icon: Plug },
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
      { title: "Configurações", url: "/configuracoes", icon: Settings },
    ],
  },
];

function filterByRole(sections: NavSection[], role: string): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessRoute(item.url, role)),
    }))
    .filter((section) => section.items.length > 0);
}

export function AppSidebar() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const chatUnread = useChatUnreadCount();

  // Inject dynamic chat badge
  const visibleSections = useMemo(() => {
    const sections = filterByRole(navSections, user?.role ?? "user");
    if (chatUnread > 0) {
      return sections.map((s) => ({
        ...s,
        items: s.items.map((item) =>
          item.url === "/chat" ? { ...item, badge: chatUnread } : item
        ),
      }));
    }
    return sections;
  }, [user?.role, chatUnread]);

  const expanded = pinned || hovered;

  // Auto-expand the section that contains the active route
  const activeSectionLabel = visibleSections.find((s) =>
    s.items.some((i) => i.url === location.pathname)
  )?.label;

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300 shrink-0 relative z-30 ${
        expanded ? "w-[240px]" : "w-[60px]"
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 h-[56px] border-b border-sidebar-border shrink-0">
        <img src={logoImg} alt="Odonto Connect" className="h-8 w-8 rounded-lg shrink-0 shadow-sm" />
        {expanded && (
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-[13px] font-bold tracking-tight text-sidebar-foreground font-heading leading-tight truncate">
              Odonto Connect
            </span>
          </div>
        )}
        {expanded && (
          <button
            onClick={() => setPinned(!pinned)}
            className={`p-1 rounded-md hover:bg-sidebar-accent transition-all duration-200 shrink-0 ${
              pinned ? "" : "opacity-60"
            }`}
            title={pinned ? "Recolher menu" : "Fixar menu"}
          >
            <ChevronLeft className={`h-3.5 w-3.5 text-sidebar-foreground/60 transition-transform ${pinned ? "" : "rotate-180"}`} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 px-1.5 space-y-1 overflow-y-auto scrollbar-thin">
        {visibleSections.map((section) => (
          <CollapsibleSection
            key={section.label}
            section={section}
            expanded={expanded}
            activePath={location.pathname}
            defaultOpen={section.label === activeSectionLabel}
          />
        ))}
      </nav>

      <SidebarUserFooter expanded={expanded} />
    </aside>
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

  // In collapsed mode, show only icons — but respect open/closed state
  if (!expanded) {
    return (
      <div className="space-y-0.5 py-1">
        {/* Section dot indicator — click to toggle */}
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center justify-center h-6 w-9 mx-auto rounded text-muted-foreground hover:text-sidebar-foreground transition-colors"
          title={`${section.label} — ${open ? "Minimizar" : "Expandir"}`}
        >
          <div className={`h-1 w-4 rounded-full transition-colors ${open ? "bg-sidebar-primary/50" : "bg-muted-foreground/30"}`} />
        </button>
        {open && section.items.map((item) => {
          const isActive = activePath === item.url;
          return (
            <Link
              key={item.title}
              to={item.url}
              className={`flex items-center justify-center h-9 w-9 mx-auto rounded-lg transition-all duration-200 relative ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
              title={item.title}
            >
              <item.icon className="h-[17px] w-[17px]" />
              {item.badge && (
                <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-destructive text-destructive-foreground text-[8px] font-bold flex items-center justify-center">
                  {item.badge}
                </span>
              )}
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
        className="flex items-center w-full px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground hover:text-sidebar-foreground transition-colors"
      >
        <span className="flex-1 text-left">{section.label}</span>
        <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="space-y-0.5">
          {section.items.map((item) => {
            const isActive = activePath === item.url;
            return (
              <Link
                key={item.title}
                to={item.url}
                className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className={`h-[16px] w-[16px] shrink-0 ${
                  isActive ? "text-sidebar-primary" : ""
                }`} />
                <span className="flex-1 truncate">{item.title}</span>
                {item.badge && (
                  <span className={`h-4 min-w-[18px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "bg-sidebar-primary/15 text-sidebar-primary"
                  }`}>
                    {item.badge}
                  </span>
                )}
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

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "??";

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  const avatarElement = user?.avatar_url ? (
    <img src={user.avatar_url} alt={user.name} className="h-8 w-8 rounded-lg object-cover shadow-sm" />
  ) : (
    <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground shadow-sm">
      {initials}
    </div>
  );

  const avatarSmall = user?.avatar_url ? (
    <img src={user.avatar_url} alt={user.name} className="h-7 w-7 rounded-lg object-cover shadow-sm" />
  ) : (
    <div className="h-7 w-7 rounded-lg gradient-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground shadow-sm">
      {initials}
    </div>
  );

  if (!expanded) {
    return (
      <div className="p-2 border-t border-sidebar-border shrink-0 space-y-1">
        <Link to="/perfil" className="block mx-auto w-fit" title="Meu Perfil">
          {avatarElement}
        </Link>
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center h-8 w-8 mx-auto rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
          title={theme === "dark" ? "Modo claro" : "Modo escuro"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center justify-center h-8 w-8 mx-auto rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
          title="Sair"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-2 border-t border-sidebar-border shrink-0 space-y-1">
      <Link to="/perfil" className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-sidebar-accent transition-colors">
        {avatarSmall}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-sidebar-foreground leading-tight truncate">{user?.name ?? "Usuário"}</p>
          <p className="text-[9px] text-muted-foreground capitalize">{user?.role ?? ""}</p>
        </div>
      </Link>
      <button
        onClick={toggleTheme}
        className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all w-full"
      >
        {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
        <span>{theme === "dark" ? "Modo Claro" : "Modo Escuro"}</span>
      </button>
      <button
        onClick={handleLogout}
        className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all w-full"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        <span>Sair</span>
      </button>
      <p className="text-[8px] text-muted-foreground/40 text-center mt-1">v2.1.1 — deploy test</p>
    </div>
  );
}
