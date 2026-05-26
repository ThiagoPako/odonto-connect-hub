import { Outlet, Link, createRootRoute, HeadContent, Scripts, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { WhatsAppConnectionBanner } from "@/components/WhatsAppConnectionBanner";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { canAccessRoute } from "@/lib/routeAccess";
import { captureUtmFromUrl } from "@/data/campanhasStore";
import { Loader2, ShieldAlert } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Página não encontrada
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function UnauthorizedComponent() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background px-4">
      <div className="max-w-md text-center space-y-4">
        <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
          <ShieldAlert className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Acesso Negado</h2>
        <p className="text-sm text-muted-foreground">
          Você não tem permissão para acessar esta página. Fale com o administrador.
        </p>
        <Link
          to="/dashboard"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Voltar ao Dashboard
        </Link>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Odonto Connect — Gestão Inteligente de Atendimento" },
      { name: "description", content: "SaaS de gestão de atendimento odontológico com WhatsApp, CRM e IA financeira." },
      { property: "og:title", content: "Odonto Connect — Gestão Inteligente de Atendimento" },
      { name: "twitter:title", content: "Odonto Connect — Gestão Inteligente de Atendimento" },
      { property: "og:description", content: "SaaS de gestão de atendimento odontológico com WhatsApp, CRM e IA financeira." },
      { name: "twitter:description", content: "SaaS de gestão de atendimento odontológico com WhatsApp, CRM e IA financeira." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/4001bcb9-5ba0-47a6-8bef-2c35ce6a55eb/id-preview-d5ddb45f--13cc4491-4be3-465b-a0f9-b514546d337a.lovable.app-1779750648705.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/4001bcb9-5ba0-47a6-8bef-2c35ce6a55eb/id-preview-d5ddb45f--13cc4491-4be3-465b-a0f9-b514546d337a.lovable.app-1779750648705.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <AuthGate />
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}

function AuthGate() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  // Captura UTMs ao carregar a aplicação
  useEffect(() => { captureUtmFromUrl(); }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isPublicPage =
    location.pathname === "/login" ||
    location.pathname === "/" ||
    location.pathname === "/signup" ||
    location.pathname.startsWith("/sb-");

  // Public pages — no sidebar, no auth required
  if (isPublicPage) {
    return <Outlet />;
  }

  // If not authenticated and not on a public page, redirect to login
  if (!isAuthenticated) {
    return <RedirectToLogin />;
  }

  // Role-based route protection
  const userRole = user?.role ?? "user";
  const hasAccess = canAccessRoute(location.pathname, userRole, !!user?.is_super_admin, user?.tenant_features);

  // Authenticated — show sidebar + content (or unauthorized)
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AppSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <WhatsAppConnectionBanner />
        <main className="flex-1 overflow-y-auto">
          {hasAccess ? <Outlet /> : <UnauthorizedComponent />}
        </main>
      </div>
    </div>
  );
}

function RedirectToLogin() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/login" });
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
