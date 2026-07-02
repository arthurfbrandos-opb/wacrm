"use client";

// Card de agente (identidade Command Center: TerminalWindow). Usado na tela
// Agentes do workspace e na aba Agentes dentro do ambiente da squad.
import Link from "next/link";
import { Bot } from "lucide-react";
import { TerminalWindow } from "@/components/ui/terminal-window";
import { AGENT_STATUS_LABEL, SPECIALTY_LABEL } from "@/lib/workspace/catalog";
import type { WorkspaceAgentRow } from "@/lib/workspace/queries";

export function AgentCard({ agent }: { agent: WorkspaceAgentRow }) {
  const active = agent.status === "active";
  return (
    <TerminalWindow title={`agentes/${agent.key}`} className="h-full" bodyClassName="flex">
      <div className="flex w-full flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </span>
            <div>
              <p className="font-mono text-sm font-medium text-foreground">{agent.name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {SPECIALTY_LABEL[agent.specialty ?? ""] ?? "Especialista"}
              </p>
            </div>
          </div>
          <span
            className={
              active
                ? "rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary"
                : "rounded-full border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
            }
          >
            {AGENT_STATUS_LABEL[agent.status] ?? agent.status}
          </span>
        </div>
        {active ? (
          <Link
            href={`/w/agentes/${agent.key}`}
            className="mt-4 block w-full rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-center font-mono text-sm font-medium text-primary transition-colors hover:bg-primary/20"
          >
            Usar agente ▸
          </Link>
        ) : (
          <button
            type="button"
            disabled
            title="Em breve"
            className="mt-4 w-full cursor-not-allowed rounded-lg border border-border px-3 py-2 font-mono text-sm text-muted-foreground opacity-60"
          >
            Usar agente · em breve
          </button>
        )}
      </div>
    </TerminalWindow>
  );
}
