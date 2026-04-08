import {
  Send,
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
  Stethoscope,
  UserRound,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
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
      { title: "Pacientes", url: "/pacientes", icon: UserRound },
      { title: "Dentistas", url: "/dentistas", icon: Stethoscope },
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
      { title: "Disparos", url: "/disparos", icon: Send },
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
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-[72px] border-b border-sidebar-border shrink-0">
        <img src={logoImg} alt="Odonto Connect" className="h-10 w-10 rounded-xl shrink-0 shadow-sm" />
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-sidebar-foreground font-heading leading-tight">
              Odonto Connect
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">
              SaaS Clínico
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`ml-auto p-1.5 rounded-lg hover:bg-sidebar-accent transition-all duration-200 ${
            collapsed ? "rotate-180" : ""
          }`}
        >
          <ChevronLeft className="h-4 w-4 text-sidebar-foreground/60" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2.5 space-y-5 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="px-3 mb-2 text-[9px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">
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
                    className={`group flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    }`}
                  >
                    <item.icon className={`h-[18px] w-[18px] shrink-0 transition-transform duration-200 ${
                      isActive ? "text-sidebar-primary" : "group-hover:scale-110"
                    }`} />
                    {!collapsed && (
                      <>
                        <span className="flex-1">{item.title}</span>
                        {item.badge && (
                          <span className={`h-5 min-w-[22px] px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                            isActive
                              ? "bg-sidebar-primary text-sidebar-primary-foreground"
                              : "bg-sidebar-primary/15 text-sidebar-primary"
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
      <div className="p-3 border-t border-sidebar-border shrink-0 space-y-2">
        {!collapsed && (
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground shadow-sm">
              DC
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-sidebar-foreground leading-tight truncate">Dr. Carlos</p>
              <p className="text-[10px] text-muted-foreground">Admin</p>
            </div>
          </div>
        )}
        <button className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all w-full">
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
