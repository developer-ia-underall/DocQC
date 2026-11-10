import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeProvider, themeScript } from "@/components/app/theme";
import { AppShell } from "@/components/app/shell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { AuthProvider, useAuth } from "@/lib/auth/context";
import { authEnabled } from "@/lib/auth/supabase";
import { Loader2 } from "lucide-react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <div className="font-mono text-[12px] text-muted-foreground">404</div>
        <h1 className="mt-2 text-lg font-semibold">Página não encontrada</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          O endereço não existe ou o documento foi removido.
        </p>
        <Button asChild className="mt-5">
          <Link to="/">Voltar à visão geral</Link>
        </Button>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">Algo correu mal</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button
            onClick={() => {
              void router.invalidate();
              reset();
            }}
          >
            Tentar de novo
          </Button>
          <Button variant="outline" asChild>
            <a href="/">Início</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "DocQC — Controlo de qualidade de documentos" },
      {
        name: "description",
        content:
          "Análise de origem, verificação de segurança, reescrita de metadados e controlo de versões de documentos.",
      },
      { property: "og:title", content: "DocQC" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const PUBLIC_PATHS = ["/login", "/auth/confirm"];

/** Com Supabase configurado, todas as páginas exceto as de entrada exigem sessão. */
function AuthGate() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { ready, session } = useAuth();
  const isPublic = PUBLIC_PATHS.includes(path);
  const blocked = authEnabled && !isPublic && ready && !session;

  useEffect(() => {
    if (blocked)
      void navigate({
        to: "/login",
        search: path === "/" ? {} : { redirect: path },
        replace: true,
      });
  }, [blocked, navigate, path]);

  if (isPublic) return <Outlet />;
  if (authEnabled && (!ready || !session))
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="A carregar" />
      </div>
    );
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
