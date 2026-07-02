"use client";

// Tela Agentes — só especialistas individuais (kind='agent'; squads têm tela própria).
// Cards vêm do os_agent_registry da conta (RLS). O botão "Usar agente" liga na
// fatia ④ (worker de produção) — até lá o estado é explícito no chip.
import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  loadWorkspaceAgents,
  type WorkspaceAgentRow,
} from "@/lib/workspace/queries";
import { AGENT_STATUS_LABEL, SPECIALTY_LABEL } from "@/lib/workspace/catalog";

export default function WorkspaceAgentsPage() {
  const [agents, setAgents] = useState<WorkspaceAgentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Client criado no effect (não no render) — prerender do build roda sem env.
    const supabase = createClient();
    loadWorkspaceAgents(supabase)
      .then((rows) => {
        if (alive) setAgents(rows);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Agentes
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold text-foreground">
          Seus especialistas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada agente abre uma tela de uso conforme a especialidade dele.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Falha ao carregar: {error}</p>
      ) : agents === null ? (
        <p className="text-sm text-muted-foreground">carregando…</p>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Bot className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 font-mono text-sm text-foreground">Nenhum agente instalado ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Os agentes do seu plano aparecem aqui assim que forem ativados.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {agents.map((a) => {
            const active = a.status === "active";
            return (
              <div key={a.key} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                      <Bot className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-mono text-sm font-medium text-foreground">{a.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {SPECIALTY_LABEL[a.specialty ?? ""] ?? "Especialista"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={
                      active
                        ? "rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary"
                        : "rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
                    }
                  >
                    {AGENT_STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
                <button
                  type="button"
                  disabled
                  title={active ? "Liga junto com a ativação da squad" : "Em breve"}
                  className="mt-4 w-full cursor-not-allowed rounded-lg border border-border px-3 py-2 font-mono text-sm text-muted-foreground opacity-60"
                >
                  Usar agente · {active ? "ativação em andamento" : "em breve"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
