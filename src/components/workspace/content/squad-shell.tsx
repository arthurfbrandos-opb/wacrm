"use client";

// Shell do ambiente da Squad Content — a sidebar TROCA pra navegação da squad
// (decisão D2: squad é ambiente de trabalho, não um card). "← workspace" volta
// pro menu do workspace.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useWorkspaceModules } from "@/hooks/use-workspace-modules";
import { moduleAvailability } from "@/lib/workspace/catalog";
import {
  ArrowLeft,
  Bot,
  CalendarDays,
  Gauge,
  Kanban,
  LogOut,
  Menu,
  MessageSquare,
  X,
  Zap,
} from "lucide-react";

const SQUAD_NAV: {
  key: string;
  label: string;
  href?: string;
  icon: typeof Gauge;
  soon?: boolean;
}[] = [
  { key: "dashboard", label: "Dashboard", href: "/w/content", icon: Gauge },
  { key: "kanban", label: "Kanban", href: "/w/content/kanban", icon: Kanban },
  { key: "calendario", label: "Calendário", href: "/w/content/calendario", icon: CalendarDays },
  { key: "chat", label: "Chat do squad", href: "/w/content/chat", icon: MessageSquare },
  { key: "agentes", label: "Agentes", href: "/w/content/agentes", icon: Bot },
];

function SquadSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { signOut } = useAuth();

  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        aria-label="Fechar menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Navegação da Squad Content"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <Zap className="h-4 w-4" />
            </span>
            <span className="font-mono text-sm font-semibold tracking-tight text-foreground">
              Squad Content
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <Link
            href="/w"
            className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            workspace
          </Link>
          <ul className="flex flex-col gap-1">
            {SQUAD_NAV.map((item) => {
              if (item.soon || !item.href) {
                return (
                  <li key={item.key}>
                    <div
                      aria-disabled="true"
                      title="Em breve"
                      className="flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2.5 font-mono text-sm font-medium text-muted-foreground opacity-60 lg:py-2"
                    >
                      <span className="w-2 shrink-0" />
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.label.toLowerCase()}</span>
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                        em breve
                      </span>
                    </div>
                  </li>
                );
              }
              const isActive =
                pathname === item.href ||
                (item.href !== "/w/content" && pathname.startsWith(item.href));
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2.5 font-mono text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="w-2 shrink-0 text-primary">{isActive ? "▸" : ""}</span>
                    <item.icon className="h-4 w-4" />
                    <span className="flex-1">{item.label.toLowerCase()}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 font-mono text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" />
            sair
          </button>
        </div>
      </aside>
    </>
  );
}

function SquadShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Gate de módulo na rota (C9): URL direta sem squad_content ligado → bloqueio
  // honesto (o RLS já protege os dados; isto protege a experiência).
  const { states: moduleStates, loading: modulesLoading } = useWorkspaceModules();
  const squadOff =
    !modulesLoading &&
    moduleStates !== null &&
    moduleAvailability(moduleStates, "squad_content") !== "on";

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (squadOff) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="font-mono text-sm font-medium text-foreground">
            Squad Content não está no seu plano
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Fale com a Negócio Simples pra ativar este módulo.
          </p>
          <Link
            href="/w"
            className="mt-4 inline-block rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 font-mono text-sm text-primary transition-colors hover:bg-primary/20"
          >
            ← Voltar ao workspace
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SquadSidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-mono text-sm font-semibold text-foreground">Squad Content</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export function SquadContentShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SquadShellInner>{children}</SquadShellInner>
    </AuthProvider>
  );
}
