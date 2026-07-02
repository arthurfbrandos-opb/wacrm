"use client";

// Agentes da Squad Content — os mesmos especialistas da tela Agentes do
// workspace, filtrados pela squad (pedido Arthur 02/07: dentro do ambiente
// da squad também dá pra usar os agentes dela direto).
import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadWorkspaceAgents, type WorkspaceAgentRow } from "@/lib/workspace/queries";
import { AgentCard } from "@/components/workspace/agent-card";

export default function SquadContentAgentsPage() {
  const [agents, setAgents] = useState<WorkspaceAgentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    loadWorkspaceAgents(supabase)
      .then((rows) => {
        if (alive) setAgents(rows.filter((a) => a.squad_key === "squad-content"));
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Squad Content
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
          Agentes da squad
        </h1>
        <p className="mt-1 max-w-2xl font-mono text-sm text-muted-foreground">
          Prefere pedir direto a um especialista em vez do chat? Cada agente abre a
          tela de uso dele.
        </p>
      </div>

      {error ? (
        <p className="font-mono text-sm text-red-400">Falha ao carregar: {error}</p>
      ) : agents === null ? (
        <p className="font-mono text-sm text-muted-foreground">carregando…</p>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Bot className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 font-mono text-sm text-foreground">
            Nenhum agente nesta squad ainda
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <AgentCard key={a.key} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
}
