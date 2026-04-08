import {
  LayoutDashboard,
  MessageSquare,
  Radio,
  DollarSign,
  Settings,
  LogOut,
  ChevronLeft,
} from "lucide-react";
import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import logoImg from "@/assets/logo.png";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Chat", url: "/chat", icon: MessageSquare },
  { title: "Canais", url: "/canais", icon: Radio },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <aside
      className={`flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300 ${
        collapsed ? "w-[68px]" : "w-[250px]"
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
        <img src={logoImg} alt="Odonto Connect" className="h-8 w-8 rounded-lg" />
        {!collapsed && (
          <span className="text-base font-bold tracking-tight text-sidebar-foreground">
            Odonto Connect
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`ml-auto p-1 rounded-md hover:bg-sidebar-accent transition-transform ${
            collapsed ? "rotate-180" : ""
          }`}
        >
          <ChevronLeft className="h-4 w-4 text-sidebar-foreground/60" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.url;
          return (
            <Link
              key={item.title}
              to={item.url}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.title}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border">
        <button className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full">
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
