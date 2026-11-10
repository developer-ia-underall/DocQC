import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutGrid,
  Files,
  UploadCloud,
  Library,
  Fingerprint,
  Settings,
  Moon,
  Sun,
  Search,
  Menu,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeft,
  Check,
  Users,
  LogOut,
  CircleHelp,
} from "lucide-react";
import { TourProvider, useTour } from "@/components/tour/tour";
import { useAuth } from "@/lib/auth/context";
import { ROLE_LABEL, atLeast } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme";
import { Kbd, KindIcon } from "./status";
import { Breadcrumbs } from "./page";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDocuments, useSettings } from "@/services/queries";
import { useUploadQueue } from "@/lib/upload-queue";

export const NAV = [
  { to: "/", label: "Visão geral", icon: LayoutGrid, key: "o" },
  { to: "/documents", label: "Documentos", icon: Files, key: "d" },
  { to: "/upload", label: "Carregar", icon: UploadCloud, key: "u" },
  { to: "/library", label: "Biblioteca de autores", icon: Library, key: "b" },
  { to: "/profiles", label: "Identidades", icon: Fingerprint, key: "i" },
  { to: "/settings", label: "Definições", icon: Settings, key: "s" },
] as const;

export function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--foreground)" />
      <path
        d="M8 6.5h5.2L17 10.3V17.5H8z"
        fill="none"
        stroke="var(--background)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10.4 13.2l1.6 1.6 3-3.2"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggle } = useTheme();
  const { data: settings } = useSettings();
  const queue = useUploadQueue();
  const active = queue.filter(
    (q) => q.stage !== "done" && q.stage !== "error" && q.stage !== "cancelled",
  ).length;
  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
  const { session, profile, signOut } = useAuth();
  const items: { to: string; label: string; icon: typeof Users }[] = [
    ...NAV,
    ...(atLeast(profile?.role, "gestor")
      ? [{ to: "/admin/users", label: "Utilizadores", icon: Users }]
      : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-12 items-center px-3", collapsed && "justify-center px-0")}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-md py-1 pl-1 pr-1.5 outline-none transition-colors hover:bg-sidebar-accent",
              !collapsed && "w-full",
            )}
          >
            <Logo />
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[13px] font-semibold leading-tight">DocQC</div>
                  <div className="truncate text-[11px] leading-tight text-muted-foreground">
                    {settings?.company.name ?? "—"}
                  </div>
                </div>
                <ChevronsUpDown className="size-3.5 text-muted-foreground" />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Espaço de trabalho</DropdownMenuLabel>
            <DropdownMenuItem>
              <Logo />
              <span className="flex-1">{settings?.company.name ?? "—"}</span>
              <Check className="!text-primary" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings /> Definições da empresa
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-px px-2">
        {items.map((n) => {
          const on = isActive(n.to);
          const item = (
            <Link
              key={n.to}
              to={n.to as never}
              onClick={onNavigate}
              data-tour={`nav-${n.to}`}
              className={cn(
                "group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                on
                  ? "text-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              {on && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-md bg-sidebar-accent"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <n.icon
                className={cn(
                  "relative size-4",
                  on ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                )}
                strokeWidth={1.6}
              />
              {!collapsed && <span className="relative flex-1 truncate">{n.label}</span>}
              {!collapsed && n.to === "/upload" && active > 0 && (
                <span className="tnum relative rounded-full bg-primary px-1.5 text-[10.5px] font-medium leading-[16px] text-primary-foreground">
                  {active}
                </span>
              )}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={n.to}>
              <TooltipTrigger asChild>{item}</TooltipTrigger>
              <TooltipContent side="right">{n.label}</TooltipContent>
            </Tooltip>
          ) : (
            item
          );
        })}
      </nav>

      <div
        className={cn(
          "border-t border-sidebar-border p-2",
          collapsed && "flex flex-col items-center gap-1",
        )}
      >
        {session && (
          <AccountMenu
            collapsed={collapsed}
            name={profile?.full_name || session.user.email?.split("@")[0] || "Conta"}
            email={session.user.email ?? ""}
            role={profile ? ROLE_LABEL[profile.role] : null}
            onSignOut={() => void signOut()}
          />
        )}
        <button
          onClick={toggle}
          className={cn(
            "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground",
            collapsed && "w-8 justify-center px-0",
          )}
          aria-label="Alternar tema"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ rotate: -40, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 40, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {theme === "dark" ? (
                <Sun className="size-4" strokeWidth={1.6} />
              ) : (
                <Moon className="size-4" strokeWidth={1.6} />
              )}
            </motion.span>
          </AnimatePresence>
          {!collapsed && <span>{theme === "dark" ? "Modo claro" : "Modo escuro"}</span>}
        </button>
      </div>
    </div>
  );
}

function AccountMenu({
  collapsed,
  name,
  email,
  role,
  onSignOut,
}: {
  collapsed: boolean;
  name: string;
  email: string;
  role: string | null;
  onSignOut: () => void;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "mb-1 flex h-9 w-full items-center gap-2.5 rounded-md px-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent/60",
          collapsed && "w-8 justify-center px-0",
        )}
        aria-label="Conta"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-[10.5px] font-semibold text-primary">
          {initials || "?"}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium leading-tight">{name}</span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
              {role ?? email}
            </span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>
          <div className="truncate text-[12.5px] font-medium text-foreground">{email}</div>
          {role && <div className="text-[11.5px] font-normal">{role}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut /> Terminar sessão
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (b: boolean) => void }) {
  const navigate = useNavigate();
  const { toggle } = useTheme();
  const { data: docs = [] } = useDocuments();
  const go = (to: string, params?: Record<string, string>) => {
    setOpen(false);
    void navigate({ to, ...(params ? { params } : {}) } as never);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose className="max-w-[560px] overflow-hidden p-0">
        <DialogTitle className="sr-only">Comandos</DialogTitle>
        <Command loop>
          <CommandInput placeholder="Pesquisar documentos, páginas e ações…" />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup heading="Ações">
              <CommandItem onSelect={() => go("/upload")}>
                <UploadCloud /> Carregar ficheiros
              </CommandItem>
              <CommandItem onSelect={() => go("/profiles")}>
                <Fingerprint /> Nova identidade
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  toggle();
                  setOpen(false);
                }}
              >
                <Moon /> Alternar tema
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Navegar">
              {NAV.map((n) => (
                <CommandItem key={n.to} value={`ir ${n.label}`} onSelect={() => go(n.to)}>
                  <n.icon /> {n.label}
                  <span className="ml-auto flex gap-1">
                    <Kbd>G</Kbd>
                    <Kbd>{n.key.toUpperCase()}</Kbd>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {docs.length > 0 && (
              <CommandGroup heading="Documentos">
                {docs.slice(0, 30).map((d) => (
                  <CommandItem
                    key={d.id}
                    value={`doc ${d.name}`}
                    onSelect={() => go("/documents/$id", { id: d.id })}
                  >
                    <KindIcon kind={d.kind} className="size-5 border-0 bg-transparent" />
                    <span className="truncate">{d.name}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      v{d.versions.length}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function HelpButton() {
  const { start } = useTour();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={start}
          data-tour="help"
          className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          aria-label="Abrir guia de utilização"
        >
          <CircleHelp className="size-4" strokeWidth={1.6} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Guia de utilização</TooltipContent>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TourProvider>
      <AppShellInner>{children}</AppShellInner>
    </TourProvider>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [cmd, setCmd] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("docqc-sidebar") === "1");
    } catch {
      /* ignore */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("docqc-sidebar", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  // ⌘K palette + Linear-style "G then key" navigation.
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmd((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "[") return toggleCollapsed();
      if (e.key.toLowerCase() === "g") {
        g = Date.now();
        return;
      }
      if (Date.now() - g < 900) {
        const n = NAV.find((x) => x.key === e.key.toLowerCase());
        if (n) {
          g = 0;
          void navigate({ to: n.to });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="flex min-h-dvh bg-background">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:block",
          collapsed ? "w-[52px]" : "w-[232px]",
        )}
      >
        <SidebarContent collapsed={collapsed} />
      </aside>
      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent side="left" className="bg-sidebar p-0">
          <SheetTitle className="sr-only">Navegação</SheetTitle>
          <SidebarContent collapsed={false} onNavigate={() => setMobile(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-sm md:px-4">
          <button
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent md:hidden"
            onClick={() => setMobile(true)}
            aria-label="Menu"
          >
            <Menu className="size-4" />
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:block"
                onClick={toggleCollapsed}
                aria-label="Recolher barra lateral"
              >
                {collapsed ? (
                  <PanelLeft className="size-4" strokeWidth={1.6} />
                ) : (
                  <PanelLeftClose className="size-4" strokeWidth={1.6} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Barra lateral <Kbd>[</Kbd>
            </TooltipContent>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <button
            onClick={() => setCmd(true)}
            data-tour="search"
            className="flex h-8 items-center gap-2 rounded-md border border-border bg-card pl-2.5 pr-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground sm:w-60"
          >
            <Search className="size-3.5" />
            <span className="hidden flex-1 text-left sm:inline">Pesquisar…</span>
            <span className="hidden gap-0.5 sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <HelpButton />
        </header>
        <main className="flex-1">{children}</main>
      </div>
      <CommandPalette open={cmd} setOpen={setCmd} />
    </div>
  );
}
