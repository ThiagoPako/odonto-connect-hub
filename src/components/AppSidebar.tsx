import {
  LayoutDashboard,
  MessageSquare,
  Radio,
  DollarSign,
  Settings,
  LogOut,
  ChevronLeft,
  Users,
  Kanban,
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
  Sparkles,
} from "lucide-react";
import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import logoImg from "@/assets/logo.png";

interface NavSection {
  label: string;
  items: { title: string; url: string; icon: typeof LayoutDashboard; badge?: number }[];
}

const navSections: NavSection[] = [
  {
    label: "Principal",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Agenda", url: "/agenda", icon: CalendarDays },
      { title: "Chat", url: "/chat", icon: MessageSquare },
    ],
  },
  {
    label: "Clínico",
    items: [
      { title: "Prontuário", url: "/prontuario", icon: FileHeart },
      { title: "Orçamentos", url: "/orcamentos", icon: Receipt },
      { title: "Tratamentos", url: "/tratamentos", icon: ClipboardList },
    ],
  },
  {
    label: "Comercial",
    items: [
      { title: "CRM", url: "/crm", icon: Users, badge: 12 },
      { title: "Funil de Vendas", url: "/funil", icon: Kanban },
      { title: "Automações", url: "/automacoes", icon: Zap },
      { title: "Reativação", url: "/reativacao", icon: RefreshCcw, badge: 5 },
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

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <aside
      className={`flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300 shrink-0 relative ${
        collapsed ? "w-[72px]" : "w-[260px]"
      }`}
    >
      {/* Decorative gradient orb */}
      <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-primary/6 to-transparent pointer-events-none" />

      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-[72px] border-b border-sidebar-border shrink-0 relative z-10">
        <div className="relative">
          <div className="absolute inset-0 rounded-xl gradient-primary opacity-15 blur-sm" />
          <img src={logoImg} alt="Odonto Connect" className="h-9 w-9 rounded-xl shrink-0 relative z-10" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-sidebar-foreground leading-tight">
              Odonto Connect
            </span>
            <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5" /> SaaS Clínico
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`ml-auto p-1.5 rounded-lg hover:bg-sidebar-accent transition-all duration-200 ${
            collapsed ? "rotate-180" : ""
          }`}
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2.5 space-y-5 overflow-y-auto relative z-10">
        {navSections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="px-3 mb-2 text-[9px] uppercase tracking-[0.15em] font-semibold text-muted-foreground/60">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = location.pathname === item.url;
                return (
                  <Link
                    key={item.title}
                    to={item.url}
                    className={`group flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-200 relative ${
                      isActive
                        ? "gradient-primary text-white shadow-glow"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                  >
                    <item.icon className={`h-[18px] w-[18px] shrink-0 transition-transform duration-200 ${
                      isActive ? "" : "group-hover:scale-110"
                    }`} />
                    {!collapsed && (
                      <>
                        <span className="flex-1">{item.title}</span>
                        {item.badge && (
                          <span className={`h-5 min-w-[22px] px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center transition-colors ${
                            isActive
                              ? "bg-white/20 text-white"
                              : "bg-primary/10 text-primary"
                          }`}>
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User & Logout */}
      <div className="p-3 border-t border-sidebar-border shrink-0 relative z-10 space-y-2">
        {!collapsed && (
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center text-[11px] font-bold text-white shadow-sm">
              DC
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-sidebar-foreground leading-tight truncate">Dr. Carlos</p>
              <p className="text-[10px] text-muted-foreground">Admin</p>
            </div>
          </div>
        )}
        <button className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all w-full">
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
