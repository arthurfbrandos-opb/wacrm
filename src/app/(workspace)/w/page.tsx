"use client";

// Visão geral do workspace — padrão Command Center (hero + MetricCard +
// TerminalWindow, mesmo idioma do /dashboard/os) com números REAIS das peças.
// Blocos de conteúdo aparecem quando squad_content tá ligado; sem o módulo,
// a tela mostra a boas-vindas + módulos do plano (nunca fingir prontidão).
import Link from "next/link";
import { CalendarClock, Cog, FileCheck, Send } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspaceModules } from "@/hooks/use-workspace-modules";
import { useContentPieces } from "@/hooks/use-content-pieces";
import { buildWorkspaceMenu, moduleAvailability } from "@/lib/workspace/catalog";
import { buildContentDashboard, piecePropostaPendente } from "@/lib/workspace/content";
import { buildWorkspaceActions, nextScheduled } from "@/lib/workspace/overview";
import { MetricCard } from "@/components/dashboard/metric-card";
import { TerminalWindow } from "@/components/ui/terminal-window";

function fmtDia(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function WorkspaceOverviewPage() {
  const { profile, account } = useAuth();
  const { states, loading } = useWorkspaceModules();
  const { pieces: todas } = useContentPieces();
  // Proposta da linha editorial não conta na visão geral até ser aprovada.
  const pieces = todas ? todas.filter((p) => !piecePropostaPendente(p)) : null;

  const firstName = profile?.full_name?.split(" ")[0] ?? "";
  const contentOn = states ? moduleAvailability(states, "squad_content") === "on" : false;

  const now = new Date();
  const dash = pieces ? buildContentDashboard(pieces, now) : null;
  const actions = pieces ? buildWorkspaceActions(pieces) : null;
  const next = pieces ? nextScheduled(pieces, now) : null;
  const producing = pieces ? pieces.filter((p) => p.status === "producao").length : null;

  const moduleRows = states
    ? buildWorkspaceMenu(states).filter((m) => m.key !== "overview" && m.key !== "config")
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Workspace{account?.name ? ` · ${account.name}` : ""}
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
          {firstName ? `Bem-vindo, ${firstName}` : "Visão geral"}
        </h1>
      </div>

      {/* Hero — estado do dia em uma frase (padrão do cockpit). */}
      <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-6">
        <p className="font-mono text-lg font-semibold leading-snug text-foreground sm:text-2xl">
          {!contentOn && !loading ? (
            <>Seu workspace está pronto — os módulos do seu plano aparecem abaixo.</>
          ) : dash ? (
            <>
              Hoje: <span className="text-primary">{dash.waitingApproval}</span>{" "}
              {dash.waitingApproval === 1 ? "peça esperando" : "peças esperando"} sua aprovação ·{" "}
              <span className="text-primary">{dash.scheduledUpcoming}</span>{" "}
              {dash.scheduledUpcoming === 1 ? "agendada" : "agendadas"}
              {next?.scheduled_at ? <> · próxima publicação {fmtDia(next.scheduled_at)}</> : null}.
            </>
          ) : (
            "carregando…"
          )}
        </p>
        <p className="mt-2 font-mono text-sm text-muted-foreground">
          A squad produz, você aprova — o resto anda sozinho.
        </p>
      </div>

      {contentOn ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Pra aprovar"
            value={dash ? `${dash.waitingApproval}` : "…"}
            icon={FileCheck}
            subtitle="esperando sua decisão"
          />
          <MetricCard
            title="Em produção"
            value={producing !== null ? `${producing}` : "…"}
            icon={Cog}
            subtitle="a squad está fazendo"
          />
          <MetricCard
            title="Agendadas"
            value={dash ? `${dash.scheduledUpcoming}` : "…"}
            icon={CalendarClock}
            subtitle="daqui pra frente"
          />
          <MetricCard
            title="Publicadas no mês"
            value={dash ? `${dash.publishedThisMonth}` : "…"}
            icon={Send}
            subtitle="já no ar"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {contentOn ? (
          <TerminalWindow title="workspace/acoes_pendentes" className="h-full">
            <div className="space-y-2 p-4">
              {actions === null ? (
                <p className="font-mono text-sm text-muted-foreground">carregando…</p>
              ) : actions.length === 0 ? (
                <p className="font-mono text-sm text-muted-foreground">
                  ▸ nada esperando você · tudo em dia.
                </p>
              ) : (
                actions.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card/40 p-3"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-300" aria-hidden />
                      <div>
                        <p className="font-mono text-sm font-medium text-foreground">{a.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">{a.subtitle}</p>
                      </div>
                    </div>
                    <Link
                      href={a.href}
                      className="shrink-0 rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                    >
                      {a.cta}
                    </Link>
                  </div>
                ))
              )}
              <p className="pt-1 font-mono text-[11px] text-muted-foreground">
                Peça nova? Monta na{" "}
                <Link href="/w/content/linha-editorial" className="text-primary hover:underline">
                  linha editorial
                </Link>
                .
              </p>
            </div>
          </TerminalWindow>
        ) : null}

        <TerminalWindow title="workspace/modulos_do_plano" className="h-full">
          <div className="p-4">
            {loading ? (
              <p className="font-mono text-sm text-muted-foreground">carregando…</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {moduleRows.map((m) => (
                  <li
                    key={m.key}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/40 px-3 py-2"
                  >
                    {m.state === "on" && m.href ? (
                      <Link
                        href={m.href}
                        className="font-mono text-sm text-foreground hover:text-primary"
                      >
                        {m.label}
                      </Link>
                    ) : (
                      <span className="font-mono text-sm text-muted-foreground">{m.label}</span>
                    )}
                    <span
                      className={
                        m.state === "on"
                          ? "rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary"
                          : "rounded-full border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
                      }
                    >
                      {m.state === "on" ? "ativo" : m.state === "coming_soon" ? "em breve" : "não incluso"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TerminalWindow>
      </div>
    </div>
  );
}
