"use client";

// Sidebar do Workspace Cliente. Mesmo idioma visual da sidebar do (dashboard),
// mas o menu nasce de plano+módulos (C9): item ON navega, OFF fica visível-desligado
// ("não incluso" — superfície de upsell), coming_soon marca "em breve". Nada escondido.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspaceModules } from "@/hooks/use-workspace-modules";
import {
  buildWorkspaceMenu,
  isWorkspaceAccount,
  type WorkspaceMenuItem,
} from "@/lib/workspace/catalog";
import {
  BookOpen,
  Bot,
  Gauge,
  GitBranch,
  LogOut,
  Settings,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

const MENU_ICON: Record<string, typeof Gauge> = {
  overview: Gauge,
  crm: GitBranch,
  agentes: Bot,
  squads: Zap,
  marca: BookOpen,
  automation_studio: Workflow,
  config: Settings,
};

function MenuRow({ item, pathname }: { item: WorkspaceMenuItem; pathname: string }) {
  const Icon = MENU_ICON[item.key] ?? Gauge;
  if (item.state === "on" && item.href) {
    const isActive =
      pathname === item.href ||
      (item.href !== "/w" && pathname.startsWith(item.href));
    return (
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
        <Icon className="h-4 w-4" />
        <span className="flex-1">{item.label.toLowerCase()}</span>
      </Link>
    );
  }
  // Vitrine (Arthur 03/07): desligado mas com teaser navega pra tela-demonstração
  // — o selo continua dizendo o estado real, a tela gera o desejo.
  if (item.teaserHref) {
    const isActive = pathname.startsWith(item.teaserHref);
    return (
      <Link
        href={item.teaserHref}
        title={item.state === "coming_soon" ? "Em breve — espia como vai ser" : "Não incluso no seu plano — espia como é"}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2.5 font-mono text-sm font-medium transition-colors lg:py-2",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground opacity-70 hover:bg-muted hover:text-foreground hover:opacity-100",
        )}
      >
        <span className="w-2 shrink-0 text-primary">{isActive ? "▸" : ""}</span>
        <Icon className="h-4 w-4" />
        <span className="flex-1">{item.label.toLowerCase()}</span>
        <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
          {item.state === "coming_soon" ? "em breve" : "não incluso"}
        </span>
      </Link>
    );
  }
  // Visível-desligado (D8): mostra o item + o motivo, nunca esconde.
  return (
    <div
      aria-disabled="true"
      title={item.state === "coming_soon" ? "Em breve" : "Não incluso no seu plano"}
      className="flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2.5 font-mono text-sm font-medium text-muted-foreground opacity-60 lg:py-2"
    >
      <span className="w-2 shrink-0" />
      <Icon className="h-4 w-4" />
      <span className="flex-1">{item.label.toLowerCase()}</span>
      <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
        {item.state === "coming_soon" ? "em breve" : "não incluso"}
      </span>
    </div>
  );
}

interface WorkspaceSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function WorkspaceSidebar({ open = false, onClose }: WorkspaceSidebarProps) {
  const pathname = usePathname();
  const { profile, account, signOut } = useAuth();
  const { states, loading } = useWorkspaceModules();

  const menu = states ? buildWorkspaceMenu(states) : [];
  // NS (tenant zero) visitando em preview mantém o caminho de volta pro
  // Command Center; conta-workspace (cliente) não tem esse atalho.
  const showBackToCC = !loading && states !== null && !isWorkspaceAccount(states);

  useEffect(() => {
    onClose?.();
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
        aria-label="Navegação do workspace"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <Link href="/w" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ns-logo.jpg"
              alt="Negócio Simples"
              className="h-8 w-8 rounded-md object-cover"
            />
            <span className="font-mono text-sm font-semibold tracking-tight text-foreground">
              Command Center
            </span>
          </Link>
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
          <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Workspace{account?.name ? ` · ${account.name}` : ""}
          </p>
          {loading ? (
            <p className="px-3 py-2 font-mono text-xs text-muted-foreground">
              carregando módulos…
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {menu.map((item) => (
                <li key={item.key}>
                  <MenuRow item={item} pathname={pathname} />
                </li>
              ))}
            </ul>
          )}

          {showBackToCC && (
            <>
              <div className="my-4 border-t border-border" />
              <Link
                href="/dashboard/os"
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 font-mono text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:py-2"
              >
                <span className="w-2 shrink-0" />
                <Gauge className="h-4 w-4" />
                ◂ minha empresa
              </Link>
            </>
          )}
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          <div className="flex w-full items-center gap-3 rounded-lg px-3 py-2">
            <Avatar className="size-8 shrink-0">
              {profile?.avatar_url ? (
                <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? "Avatar"} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                {profile?.full_name?.charAt(0)?.toUpperCase() ??
                  profile?.email?.charAt(0)?.toUpperCase() ??
                  "U"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {profile?.full_name ?? "Usuário"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {profile?.email ?? ""}
              </p>
            </div>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sair"
              title="Sair"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
