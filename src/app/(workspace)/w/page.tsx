"use client";

// Visão geral do Workspace — cockpit da OPERAÇÃO (pedido Arthur 02/07): gestão
// dos agentes que trabalham pra ele + atividade viva + o que espera ELE.
// Detalhe de conteúdo vive no dashboard da Squad Content, não aqui.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, Bot, FileCheck, Zap } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspaceModules } from "@/hooks/use-workspace-modules";
import { useContentPieces } from "@/hooks/use-content-pieces";
import { createClient } from "@/lib/supabase/client";
import { buildWorkspaceMenu, moduleAvailability, SPECIALTY_LABEL } from "@/lib/workspace/catalog";
import { piecePropostaPendente } from "@/lib/workspace/content";
import { buildWorkspaceActions } from "@/lib/workspace/overview";
import { loadWorkspaceAgents, type WorkspaceAgentRow } from "@/lib/workspace/queries";
import { MetricCard } from "@/components/dashboard/metric-card";
import { TerminalWindow } from "@/components/ui/terminal-window";

interface EventRow {
  id: string;
  agent: string | null;
  summary: string;
  created_at: string;
}

const TIME_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default function WorkspaceOverviewPage() {
  const { profile, account } = useAuth();
  const { states, loading } = useWorkspaceModules();
  const { pieces: todas } = useContentPieces();
  // Proposta da linha editorial não conta na visão geral até ser aprovada.
  const pieces = todas ? todas.filter((p) => !piecePropostaPendente(p)) : null;

  const [agents, setAgents] = useState<WorkspaceAgentRow[] | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    loadWorkspaceAgents(supabase)
      .then((rows) => {
        if (alive) setAgents(rows);
      })
      .catch(() => {
        if (alive) setAgents([]);
      });
    supabase
      .from("os_events")
      .select("id, agent, summary, created_at")
      .order("created_at", { ascending: false })
      .limit(8)
      .then(({ data }) => {
        if (alive) setEvents((data as EventRow[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, []);

  const firstName = profile?.full_name?.split(" ")[0] ?? "";
  const contentOn = states ? moduleAvailability(states, "squad_content") === "on" : false;

  const ativos = agents ? agents.filter((a) => a.status === "active") : null;
  const squadsAtivas = ativos
    ? [...new Set(ativos.map((a) => a.squad_key).filter(Boolean))].length
    : null;
  const actions = pieces ? buildWorkspaceActions(pieces) : null;
  const hoje = new Date().toDateString();
  const atividadeHoje = events
    ? events.filter((e) => new Date(e.created_at).toDateString() === hoje).length
    : null;

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

      {/* Hero — a operação em uma frase: agentes trabalhando + o que espera ele. */}
      <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-6">
        <p className="font-mono text-lg font-semibold leading-snug text-foreground sm:text-2xl">
          {ativos === null ? (
            "carregando…"
          ) : (
            <>
              Sua operação: <span className="text-primary">{ativos.length}</span>{" "}
              {ativos.length === 1 ? "agente ativo" : "agentes ativos"}
              {squadsAtivas ? (
                <>
                  {" "}
                  em <span className="text-primary">{squadsAtivas}</span>{" "}
                  {squadsAtivas === 1 ? "squad" : "squads"}
                </>
              ) : null}
              {actions && actions.length > 0 ? (
                <>
                  {" "}
                  · <span className="text-primary">{actions.length}</span>{" "}
                  {actions.length === 1 ? "decisão esperando" : "decisões esperando"} você
                </>
              ) : (
                <> · nada esperando você</>
              )}
              .
            </>
          )}
        </p>
        <p className="mt-2 font-mono text-sm text-muted-foreground">
          Os agentes trabalham, você decide — cada movimento fica registrado aqui.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Agentes ativos"
          value={ativos ? `${ativos.length}` : "…"}
          icon={Bot}
          subtitle="trabalhando pra você"
        />
        <MetricCard
          title="Squads"
          value={squadsAtivas !== null ? `${squadsAtivas}` : "…"}
          icon={Zap}
          subtitle="frentes montadas"
        />
        <MetricCard
          title="Atividades hoje"
          value={atividadeHoje !== null ? `${atividadeHoje}` : "…"}
          icon={Activity}
          subtitle="movimentos dos agentes"
        />
        <MetricCard
          title="Esperando você"
          value={actions ? `${actions.length}` : "…"}
          icon={FileCheck}
          subtitle="decisões pendentes"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Time de agentes — quem trabalha pra ele, por squad. */}
        <TerminalWindow title="operacao/agentes" className="h-full">
          <div className="flex h-full flex-col p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-sm font-medium text-foreground">Seu time de agentes</p>
              <Link href="/w/agentes" className="font-mono text-xs text-primary hover:underline">
                ver todos ▸
              </Link>
            </div>
            {agents === null ? (
              <p className="mt-3 font-mono text-sm text-muted-foreground">carregando…</p>
            ) : agents.length === 0 ? (
              <p className="mt-3 font-mono text-sm text-muted-foreground">
                ▸ seus agentes aparecem aqui na implantação.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {agents.slice(0, 6).map((a) => (
                  <li
                    key={a.key}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/40 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Bot className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate font-mono text-sm text-foreground">{a.name}</span>
                      <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:inline">
                        {SPECIALTY_LABEL[a.specialty ?? ""] ?? "Especialista"}
                      </span>
                    </span>
                    <span
                      className={
                        a.status === "active"
                          ? "shrink-0 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary"
                          : "shrink-0 rounded-full border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
                      }
                    >
                      {a.status === "active" ? "ativo" : "em breve"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TerminalWindow>

        {/* Atividade viva — os_events é a prova de que a operação anda sozinha. */}
        <TerminalWindow title="operacao/atividade" className="h-full">
          <div className="p-4">
            <p className="font-mono text-sm font-medium text-foreground">Atividade dos agentes</p>
            {events === null ? (
              <p className="mt-3 font-mono text-sm text-muted-foreground">carregando…</p>
            ) : events.length === 0 ? (
              <p className="mt-3 font-mono text-sm text-muted-foreground">
                ▸ os movimentos dos agentes aparecem aqui.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-1.5">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs text-foreground">
                        {e.summary}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {e.agent ? `${e.agent} · ` : ""}
                        {TIME_FMT.format(new Date(e.created_at))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TerminalWindow>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {contentOn ? (
          <TerminalWindow title="workspace/esperando_voce" className="h-full">
            <div className="space-y-2 p-4">
              <p className="font-mono text-sm font-medium text-foreground">Esperando sua decisão</p>
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
                Conteúdo? A gestão completa fica na{" "}
                <Link href="/w/content" className="text-primary hover:underline">
                  Squad Content
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
